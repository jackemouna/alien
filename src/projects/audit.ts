import { appendAuditLog } from "../security/audit-log.js";
import type { TaskOrigin, TaskRecord } from "./types.js";

/**
 * Thin convenience over the tamper-evident audit log (src/security/audit-log.ts).
 * Every Project/Task transition emits a hash-chained entry under the
 * `projects.*` namespace so the operator can answer:
 *
 *   - "who created this task and from which channel?" (origin)
 *   - "who claimed it, when, and how many attempts?"
 *   - "did the runner respect the approval gate?"
 *
 * The audit log is deliberately *not* the source of truth for project state —
 * it is an append-only audit trail. Project state lives in the Project store.
 */

export type ProjectsAuditKind =
  | "projects.project.created"
  | "projects.project.archived"
  | "projects.project.iteration_started"
  | "projects.project.goal_achieved"
  | "projects.project.stuck"
  | "projects.task.created"
  | "projects.task.queued"
  | "projects.task.claimed"
  | "projects.task.completed"
  | "projects.task.in_review"
  | "projects.task.failed"
  | "projects.task.blocked"
  | "projects.task.approved";

export type EmitProjectsAuditEventOptions = {
  readonly auditLogPath: string;
  readonly now?: () => number;
};

export function emitProjectsAuditEvent(
  event: { kind: ProjectsAuditKind; payload: Record<string, unknown> },
  opts: EmitProjectsAuditEventOptions,
): void {
  appendAuditLog(
    { kind: event.kind, payload: event.payload },
    opts.now ? { logPath: opts.auditLogPath, now: opts.now } : { logPath: opts.auditLogPath },
  );
}

/**
 * Build a compact payload for a task event so audit lines don't balloon with
 * the worker's full input/output blobs. We capture the identifying fields
 * plus the origin (so reviewers can correlate to channels).
 */
export function summarizeTaskForAudit(task: TaskRecord): Record<string, unknown> {
  return {
    projectId: task.projectId,
    taskId: task.id,
    role: task.role,
    status: task.status,
    priority: task.priority,
    attempts: task.attempts,
    origin: redactOrigin(task.origin),
  };
}

function redactOrigin(origin: TaskOrigin): Record<string, unknown> {
  if (origin.kind === "channel") {
    // Display name is user-controlled content; tolerate but truncate.
    const display = origin.authorDisplayName?.slice(0, 64);
    return {
      kind: "channel",
      channel: origin.channel,
      ...(origin.accountId ? { accountId: origin.accountId } : {}),
      ...(origin.threadId ? { threadId: origin.threadId } : {}),
      ...(display ? { authorDisplayName: display } : {}),
    };
  }
  if (origin.kind === "planner") {
    return { kind: "planner", runId: origin.runId };
  }
  return { kind: origin.kind };
}
