import { appendAuditLog } from "../security/audit-log.js";
import { currentOrigin } from "../security/origin-context.js";
import {
  computeRunStatus,
  dependencyOutputsFor,
  markTaskFailed,
  markTaskRunning,
  markTaskSucceeded,
  nextRunnableTask,
  withTransitionedStatus,
} from "./run-state.js";
import { saveRun } from "./run-store.js";
import type { Run, WorkerRegistry } from "./types.js";

/**
 * Walks the Run's task list one task at a time:
 *   nextRunnableTask → markRunning → execute worker → markSucceeded/Failed
 *   → persist → audit-log → repeat.
 *
 * Returns when no more tasks are runnable (every remaining pending task is
 * blocked by a failed dependency, or every task is terminal). Crash-safe:
 * the persisted Run carries every output downstream tasks need to resume,
 * so calling runOrchestratorRun(loadRun(...)) picks up where we left off.
 *
 * Audit-log entries are emitted with origin from M3's currentOrigin() so a
 * reviewer can tell whether a run was started by an operator, an HTTP-API
 * caller, or an inbound channel.
 */

export type RunnerOptions = {
  /** Where to persist run state. <orchestratorDir>/runs/<runId>.json. */
  readonly orchestratorDir: string;
  /** Tamper-evident audit log path; unset = no audit-log writes. */
  readonly auditLogPath?: string;
  /** Abort signal forwarded to workers. */
  readonly signal?: AbortSignal;
  /** Override hook for the current time (default Date.now). */
  readonly now?: () => string;
};

export type RunnerResult = {
  readonly run: Run;
  readonly tasksAttempted: number;
};

export async function runOrchestratorRun(
  run: Run,
  workers: WorkerRegistry,
  options: RunnerOptions,
): Promise<RunnerResult> {
  const now = options.now ?? defaultNow;
  let current = run;
  let tasksAttempted = 0;

  // Initial save so the run is on disk even if the very first task crashes.
  current = withTransitionedStatus(current, now);
  saveRun(options.orchestratorDir, current);
  emitAudit(options, "orchestrator.run.started", {
    runId: current.id,
    workflowId: current.workflowId,
    taskCount: current.tasks.length,
  });

  for (;;) {
    if (options.signal?.aborted) {
      emitAudit(options, "orchestrator.run.aborted", { runId: current.id });
      break;
    }

    const next = nextRunnableTask(current);
    if (!next) {
      break;
    }

    tasksAttempted += 1;
    current = markTaskRunning(current, next.id, now);
    saveRun(options.orchestratorDir, current);
    emitAudit(options, "orchestrator.task.started", {
      runId: current.id,
      taskId: next.id,
      role: next.role,
      attempts: next.attempts + 1,
    });

    const worker = workers[next.role];
    if (!worker) {
      const error = `runner: no worker registered for role "${next.role}"`;
      current = markTaskFailed(current, next.id, error, now);
      saveRun(options.orchestratorDir, current);
      emitAudit(options, "orchestrator.task.failed", {
        runId: current.id,
        taskId: next.id,
        role: next.role,
        error,
      });
      continue;
    }

    let workerOutput: Awaited<ReturnType<typeof worker>>;
    try {
      workerOutput = await worker({
        task: { ...next, status: "running", attempts: next.attempts + 1 },
        dependencyOutputs: dependencyOutputsFor(current, next.id),
        run: { id: current.id, workflowId: current.workflowId, metadata: current.metadata },
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      const error = stringifyError(err);
      current = markTaskFailed(current, next.id, error, now);
      saveRun(options.orchestratorDir, current);
      emitAudit(options, "orchestrator.task.failed", {
        runId: current.id,
        taskId: next.id,
        role: next.role,
        error,
      });
      continue;
    }

    if (workerOutput.ok) {
      current = markTaskSucceeded(current, next.id, workerOutput.result, now);
      saveRun(options.orchestratorDir, current);
      emitAudit(options, "orchestrator.task.succeeded", {
        runId: current.id,
        taskId: next.id,
        role: next.role,
      });
    } else {
      current = markTaskFailed(current, next.id, workerOutput.error ?? "(no error)", now);
      saveRun(options.orchestratorDir, current);
      emitAudit(options, "orchestrator.task.failed", {
        runId: current.id,
        taskId: next.id,
        role: next.role,
        error: workerOutput.error ?? "(no error)",
      });
    }
  }

  current = withTransitionedStatus(current, now);
  saveRun(options.orchestratorDir, current);
  const finalStatus = computeRunStatus(current);
  emitAudit(options, `orchestrator.run.${finalStatus}`, {
    runId: current.id,
    workflowId: current.workflowId,
    tasksAttempted,
  });

  return { run: current, tasksAttempted };
}

function emitAudit(options: RunnerOptions, kind: string, payload: Record<string, unknown>): void {
  if (!options.auditLogPath) {
    return;
  }
  try {
    const origin = currentOrigin();
    appendAuditLog(
      {
        kind,
        payload: {
          ...payload,
          origin: origin.source,
          originUntrusted: origin.untrusted,
          ...(origin.details ? { originDetails: origin.details } : {}),
        },
      },
      { logPath: options.auditLogPath },
    );
  } catch {
    // best-effort; runner must not fail because audit-log write failed
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
