import type { Run, RunStatus, Task, TaskRecord, WorkflowDefinition } from "./types.js";

/**
 * Pure helpers for transitioning a Run/TaskRecord through its lifecycle.
 * Persistence is layered separately (run-store.ts) so the state machine is
 * trivially testable without touching the filesystem.
 */

export function createRunFromWorkflow(params: {
  runId: string;
  workflow: WorkflowDefinition;
  now?: () => string;
}): Run {
  const now = (params.now ?? defaultNow)();
  return {
    id: params.runId,
    workflowId: params.workflow.id,
    createdAt: now,
    status: "pending",
    tasks: params.workflow.tasks.map(taskRecordFromDefinition),
    ...(params.workflow.metadata ? { metadata: { ...params.workflow.metadata } } : {}),
  };
}

function taskRecordFromDefinition(task: Task): TaskRecord {
  return {
    ...task,
    status: "pending",
    attempts: 0,
  };
}

/**
 * Pick the next task that is ready to run: status=pending, all dependencies
 * succeeded. Returns undefined when the run is finished (no pending tasks
 * left) OR blocked (pending tasks remain but their dependencies have not
 * succeeded — a `failed` dependency leaves the run blocked unless the
 * caller retries it).
 */
export function nextRunnableTask(run: Run): TaskRecord | undefined {
  for (const task of run.tasks) {
    if (task.status !== "pending") {
      continue;
    }
    const deps = task.dependsOn;
    if (deps.length === 0) {
      return task;
    }
    const allSucceeded = deps.every(
      (depId) => run.tasks.find((t) => t.id === depId)?.status === "succeeded",
    );
    if (allSucceeded) {
      return task;
    }
  }
  return undefined;
}

export function markTaskRunning(run: Run, taskId: string, now?: () => string): Run {
  const ts = (now ?? defaultNow)();
  return updateTask(run, taskId, (t) => ({
    ...t,
    status: "running",
    startedAt: t.startedAt ?? ts,
    attempts: t.attempts + 1,
  }));
}

export function markTaskSucceeded(
  run: Run,
  taskId: string,
  output: unknown,
  now?: () => string,
): Run {
  const ts = (now ?? defaultNow)();
  return updateTask(run, taskId, (t) => ({
    ...t,
    status: "succeeded",
    output,
    completedAt: ts,
  }));
}

export function markTaskFailed(run: Run, taskId: string, error: string, now?: () => string): Run {
  const ts = (now ?? defaultNow)();
  return updateTask(run, taskId, (t) => ({
    ...t,
    status: "failed",
    error,
    completedAt: ts,
  }));
}

export function resetTaskForRetry(run: Run, taskId: string): Run {
  return updateTask(run, taskId, (t) => {
    const { error: _err, ...rest } = t;
    return {
      ...rest,
      status: "pending",
      startedAt: undefined,
      completedAt: undefined,
    };
  });
}

/**
 * Compute the run-level status from the task records:
 *   - "pending" when no task has started yet
 *   - "running" when at least one task is running OR succeeded but the run
 *     still has unblocked pending tasks
 *   - "succeeded" when every task succeeded or skipped
 *   - "failed" when at least one task failed AND no pending unblocked task
 *     remains (i.e. the run cannot make further progress without operator
 *     intervention)
 */
export function computeRunStatus(run: Run): RunStatus {
  const hasFailed = run.tasks.some((t) => t.status === "failed");
  const hasRunning = run.tasks.some((t) => t.status === "running");
  const allTerminal = run.tasks.every(
    (t) => t.status === "succeeded" || t.status === "skipped" || t.status === "failed",
  );
  const hasStarted = run.tasks.some((t) => t.status !== "pending" && t.status !== "skipped");

  if (hasRunning) {
    return "running";
  }
  if (allTerminal) {
    return hasFailed ? "failed" : "succeeded";
  }
  if (!hasStarted) {
    return "pending";
  }
  // Pending tasks remain. If any of them are blocked by a failed dependency,
  // the run is `failed` (can't make progress); otherwise it's still running.
  if (nextRunnableTask(run)) {
    return "running";
  }
  return hasFailed ? "failed" : "running";
}

export function withTransitionedStatus(run: Run, now?: () => string): Run {
  const status = computeRunStatus(run);
  const ts = (now ?? defaultNow)();
  const next: Run = { ...run, status };
  if (!run.startedAt && status !== "pending") {
    next.startedAt = ts;
  }
  if (!run.completedAt && (status === "succeeded" || status === "failed")) {
    next.completedAt = ts;
  }
  return next;
}

export function dependencyOutputsFor(run: Run, taskId: string): Record<string, unknown> {
  const task = run.tasks.find((t) => t.id === taskId);
  if (!task) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const depId of task.dependsOn) {
    const dep = run.tasks.find((t) => t.id === depId);
    if (dep && dep.status === "succeeded") {
      out[depId] = dep.output;
    }
  }
  return out;
}

function updateTask(run: Run, taskId: string, transform: (t: TaskRecord) => TaskRecord): Run {
  return {
    ...run,
    tasks: run.tasks.map((t) => (t.id === taskId ? transform(t) : t)),
  };
}

function defaultNow(): string {
  return new Date().toISOString();
}
