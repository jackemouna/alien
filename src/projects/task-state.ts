import type { Priority, Project, TaskDraft, TaskOrigin, TaskRecord, TaskStatus } from "./types.js";

/**
 * Pure helpers for transitioning Tasks through their lifecycle.
 * Persistence is layered separately (store.ts) so the state machine is
 * trivially testable without touching the filesystem.
 *
 * Status graph:
 *
 *   backlog ─┐
 *            └─▶ queued ─▶ in-progress ─┬─▶ review ─▶ done
 *                                       ├─▶ done
 *                                       └─▶ failed
 *
 * Any state can be moved back to "queued" by resetTaskForRetry(). A blocked
 * task is set externally when an upstream dependency fails — it doesn't
 * auto-recover; the operator decides to retry or archive.
 */

const DEFAULT_PRIORITY: Priority = "normal";

export function createTaskRecord(params: {
  taskId: string;
  projectId: string;
  draft: TaskDraft;
  origin: TaskOrigin;
  now?: () => string;
}): TaskRecord {
  const ts = (params.now ?? defaultNow)();
  const requiresApproval = params.draft.requiresApproval === true;
  const initialStatus: TaskStatus = requiresApproval ? "backlog" : "queued";
  return {
    id: params.taskId,
    projectId: params.projectId,
    title: params.draft.title,
    description: params.draft.description,
    role: params.draft.role,
    dependsOn: [...params.draft.dependsOn],
    input: { ...params.draft.input },
    origin: params.origin,
    priority: params.draft.priority ?? DEFAULT_PRIORITY,
    createdAt: ts,
    status: initialStatus,
    attempts: 0,
    ...(requiresApproval ? { requiresApproval: true } : {}),
    ...(params.draft.expertId ? { expertId: params.draft.expertId } : {}),
  };
}

/**
 * The "queue" is the working set the auto-pickup loop scans. A task is
 * eligible when (a) status is "queued" AND (b) every dependency has status
 * "done". Skipping a "review" dependency is intentional — review pauses the
 * downstream chain.
 */
export function isTaskEligibleForPickup(
  task: TaskRecord,
  allTasks: readonly TaskRecord[],
): boolean {
  if (task.status !== "queued") {
    return false;
  }
  if (task.claimedBy) {
    return false;
  }
  return task.dependsOn.every((depId) => allTasks.find((t) => t.id === depId)?.status === "done");
}

export function findEligibleTask(
  tasks: readonly TaskRecord[],
  role: TaskRecord["role"],
): TaskRecord | undefined {
  // Highest-priority first, then oldest-created first within a priority band.
  // Deterministic ordering preserves prompt-cache locality for the planner
  // and keeps the audit log readable.
  const sorted = [...tasks]
    .filter((t) => t.role === role && isTaskEligibleForPickup(t, tasks))
    .toSorted((a, b) => {
      const pa = PRIORITY_ORDER[a.priority];
      const pb = PRIORITY_ORDER[b.priority];
      if (pa !== pb) return pb - pa;
      return a.createdAt < b.createdAt ? -1 : 1;
    });
  return sorted[0];
}

const PRIORITY_ORDER: Record<Priority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

export function markTaskQueued(task: TaskRecord, now?: () => string): TaskRecord {
  if (task.status === "queued") {
    return task;
  }
  return resetClaim({ ...task, status: "queued" }, now);
}

export function markTaskClaimed(
  task: TaskRecord,
  claimedBy: string,
  now?: () => string,
): TaskRecord {
  const ts = (now ?? defaultNow)();
  return {
    ...task,
    status: "in-progress",
    claimedBy,
    claimedAt: ts,
    startedAt: task.startedAt ?? ts,
    attempts: task.attempts + 1,
  };
}

export function markTaskInReview(
  task: TaskRecord,
  output: unknown,
  now?: () => string,
): TaskRecord {
  const ts = (now ?? defaultNow)();
  return {
    ...task,
    status: "review",
    output,
    completedAt: ts,
  };
}

export function markTaskDone(task: TaskRecord, output: unknown, now?: () => string): TaskRecord {
  const ts = (now ?? defaultNow)();
  return {
    ...task,
    status: "done",
    output,
    completedAt: ts,
  };
}

export function markTaskFailed(task: TaskRecord, error: string, now?: () => string): TaskRecord {
  const ts = (now ?? defaultNow)();
  return {
    ...task,
    status: "failed",
    error,
    completedAt: ts,
  };
}

export function markTaskBlocked(task: TaskRecord, reason: string): TaskRecord {
  return { ...task, status: "blocked", error: reason };
}

export function approveTaskForQueue(task: TaskRecord, now?: () => string): TaskRecord {
  if (task.status !== "backlog") {
    return task;
  }
  const next = markTaskQueued(task, now);
  if (next.requiresApproval) {
    const { requiresApproval: _approved, ...rest } = next;
    return rest as TaskRecord;
  }
  return next;
}

export function resetTaskForRetry(task: TaskRecord, now?: () => string): TaskRecord {
  return resetClaim(
    {
      ...task,
      status: "queued",
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
    },
    now,
  );
}

function resetClaim(task: TaskRecord, _now?: () => string): TaskRecord {
  const { claimedBy: _by, claimedAt: _at, ...rest } = task;
  return rest as TaskRecord;
}

/**
 * Project-level status is derived: a project is "active" while it has any
 * task that is not in a terminal state, "paused" only when the operator
 * sets it manually (this helper never returns "paused"), and "archived"
 * when the operator archives it (also never returned here).
 */
export function isProjectIdle(project: Project, tasks: readonly TaskRecord[]): boolean {
  if (project.status !== "active") {
    return true;
  }
  return tasks.every((t) => t.status === "done" || t.status === "failed" || t.status === "blocked");
}

function defaultNow(): string {
  return new Date().toISOString();
}
