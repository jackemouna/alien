import type { WorkerRole } from "../orchestrator/types.js";
import { runAsChannel, runAsOperator } from "../security/origin-context.js";
import { emitProjectsAuditEvent, summarizeTaskForAudit } from "./audit.js";
import {
  listProjectIds,
  listTasks,
  loadProject,
  saveTask,
  type ProjectStoreOptions,
} from "./store.js";
import { claimTask } from "./task-claim.js";
import { markTaskDone, markTaskFailed, markTaskInReview } from "./task-state.js";
import type { Project, TaskRecord } from "./types.js";

/**
 * Auto-pickup loop — the heart of the workforce model. Every interval the
 * loop scans active projects, asks each registered worker role whether it
 * has any eligible queued tasks, claims one race-safely via task-claim, and
 * invokes the worker. Worker output is persisted, audit-logged, and the
 * next tick picks up the now-unblocked downstream tasks.
 *
 * The loop is intentionally single-process and single-threaded within a
 * tick. Race safety across multiple loop instances (e.g., gateway + ad-hoc
 * CLI) is provided by the per-project file lock in `task-claim.ts`.
 *
 * Worker contract is *project-aware*; orchestrator-style workers can be
 * adapted with a thin shim. Workers must be pure-ish from the loop's
 * perspective: take the task + dependency outputs, return ok/result/error.
 */

export type DependencyOutputs = Record<string, unknown>;

export type ProjectWorkerInput = {
  readonly task: TaskRecord;
  readonly project: Project;
  readonly dependencyOutputs: DependencyOutputs;
  readonly signal?: AbortSignal;
};

export type ProjectWorkerOutput = {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
  /** When true, the worker's output goes into "review" instead of "done". */
  readonly toReview?: boolean;
};

export type ProjectWorker = (input: ProjectWorkerInput) => Promise<ProjectWorkerOutput>;

export type ProjectWorkerRegistry = Readonly<Record<WorkerRole, ProjectWorker>>;

export type PickupLoopOptions = {
  readonly projectsDir: string;
  readonly auditLogPath?: string;
  readonly workers: ProjectWorkerRegistry;
  readonly claimedBy: string;
  readonly intervalMs?: number;
  readonly storeOptions?: ProjectStoreOptions;
  readonly signal?: AbortSignal;
  readonly now?: () => string;
  /**
   * Optional override for the per-tick work. Tests inject this to drive
   * ticks deterministically without setInterval.
   */
  readonly schedule?: (tick: () => Promise<void>) => () => void;
};

export type PickupLoopHandle = {
  readonly stop: () => void;
  /** Run one tick synchronously; useful for tests and graceful shutdown. */
  readonly runOnce: () => Promise<void>;
};

const DEFAULT_INTERVAL_MS = 2_500;

export function startPickupLoop(opts: PickupLoopOptions): PickupLoopHandle {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    await runPickupTick(opts);
  };

  const schedule =
    opts.schedule ??
    ((cb: () => Promise<void>) => {
      const handle = setInterval(() => {
        void cb();
      }, intervalMs);
      return () => clearInterval(handle);
    });

  const cancel = schedule(tick);
  if (opts.signal) {
    opts.signal.addEventListener(
      "abort",
      () => {
        stopped = true;
        cancel();
      },
      { once: true },
    );
  }

  return {
    stop: () => {
      stopped = true;
      cancel();
    },
    runOnce: tick,
  };
}

export async function runPickupTick(opts: PickupLoopOptions): Promise<void> {
  const projectIds = listProjectIds(opts.projectsDir, opts.storeOptions);
  for (const projectId of projectIds) {
    const project = loadProject(opts.projectsDir, projectId, opts.storeOptions);
    if (!project || project.status !== "active") continue;
    for (const role of Object.keys(opts.workers) as WorkerRole[]) {
      const claim = await claimTask({
        projectsDir: opts.projectsDir,
        projectId,
        role,
        claimedBy: opts.claimedBy,
        ...(opts.storeOptions ? { storeOptions: opts.storeOptions } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      });
      if (!claim.ok) continue;
      emitAudit("projects.task.claimed", claim.task, opts);
      await runWorkerForTask(claim.task, project, opts);
    }
  }
}

async function runWorkerForTask(
  task: TaskRecord,
  project: Project,
  opts: PickupLoopOptions,
): Promise<void> {
  const worker = opts.workers[task.role];
  if (!worker) {
    const failed = markTaskFailed(task, `no worker registered for role ${task.role}`, opts.now);
    saveTask(opts.projectsDir, failed, opts.storeOptions);
    emitAudit("projects.task.failed", failed, opts);
    return;
  }

  const dependencyOutputs = resolveDependencyOutputs(task, opts);
  try {
    const output = await runUnderTaskOrigin(task, project, () =>
      worker({
        task,
        project,
        dependencyOutputs,
        ...(opts.signal ? { signal: opts.signal } : {}),
      }),
    );
    if (!output.ok) {
      const failed = markTaskFailed(task, output.error ?? "worker reported ok=false", opts.now);
      saveTask(opts.projectsDir, failed, opts.storeOptions);
      emitAudit("projects.task.failed", failed, opts);
      return;
    }
    const next = output.toReview
      ? markTaskInReview(task, output.result, opts.now)
      : markTaskDone(task, output.result, opts.now);
    saveTask(opts.projectsDir, next, opts.storeOptions);
    emitAudit(output.toReview ? "projects.task.in_review" : "projects.task.completed", next, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = markTaskFailed(task, message, opts.now);
    saveTask(opts.projectsDir, failed, opts.storeOptions);
    emitAudit("projects.task.failed", failed, opts);
  }
}

function runUnderTaskOrigin<T>(
  task: TaskRecord,
  project: Project,
  fn: () => Promise<T>,
): Promise<T> {
  const details = { projectId: project.id, taskId: task.id };
  if (task.origin.kind === "channel") {
    return runAsChannel(
      task.origin.channel,
      {
        ...details,
        ...(task.origin.accountId ? { accountId: task.origin.accountId } : {}),
        ...(task.origin.threadId ? { threadId: task.origin.threadId } : {}),
      },
      fn,
    );
  }
  return runAsOperator(fn, details);
}

function resolveDependencyOutputs(task: TaskRecord, opts: PickupLoopOptions): DependencyOutputs {
  if (task.dependsOn.length === 0) return {};
  const tasks = listTasks(opts.projectsDir, task.projectId, opts.storeOptions);
  const out: DependencyOutputs = {};
  for (const depId of task.dependsOn) {
    const dep = tasks.find((t) => t.id === depId);
    if (dep && dep.status === "done") {
      out[depId] = dep.output;
    }
  }
  return out;
}

function emitAudit(
  kind: Parameters<typeof emitProjectsAuditEvent>[0]["kind"],
  task: TaskRecord,
  opts: PickupLoopOptions,
): void {
  if (!opts.auditLogPath) return;
  emitProjectsAuditEvent(
    { kind, payload: summarizeTaskForAudit(task) },
    { auditLogPath: opts.auditLogPath },
  );
}
