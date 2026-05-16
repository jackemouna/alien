import { randomUUID } from "node:crypto";
import { emitProjectsAuditEvent } from "./audit.js";
import { findCapability } from "./capability-catalog.js";
import { appendCapabilityRequest, type CapabilityRequest } from "./capability-requests-store.js";
import type { ProjectWorker, ProjectWorkerOutput } from "./pickup-loop.js";
import { saveProject } from "./store.js";

/**
 * The capability-broker worker (Phase B). When the planner identifies a
 * gap — "I need to integrate with Stripe but there's no payment worker" —
 * it emits a task with role: "capability-broker" and input:
 *
 *   { integration: "stripe", why: "...", sketch?: "..." }
 *
 * The broker:
 *
 *   1. Checks the catalog. If the requested capability already exists,
 *      it returns ok:false with a friendly "use X instead" message so
 *      the planner can pivot on the next iteration.
 *   2. Otherwise, records the request to ${state-dir}/capability-requests.json,
 *      emits a projects.capability.requested audit event, and flips the
 *      parent project to "needs-input" so the operator notices.
 *   3. Returns ok:true so the task itself transitions to "done" — the
 *      gating is at the project level, not the task level.
 *
 * Future work (Phase C): the broker also signals a self-coding worker to
 * pick up the request, write a new extension, and notify the operator
 * when ready for approval.
 */

export type CapabilityBrokerOptions = {
  /** Audit log path, so capability requests appear in the same trail as task events. */
  readonly auditLogPath?: string;
  /** Projects dir, needed to flip the parent project status. */
  readonly projectsDir: string;
  readonly now?: () => string;
};

export function createCapabilityBrokerWorker(opts: CapabilityBrokerOptions): ProjectWorker {
  return async ({ task, project }): Promise<ProjectWorkerOutput> => {
    const input = task.input as {
      integration?: unknown;
      why?: unknown;
      sketch?: unknown;
    };
    const integration = readStr(input.integration);
    const why = readStr(input.why);
    if (!integration || !why) {
      return {
        ok: false,
        error: "capability-broker requires { integration, why } in task.input",
      };
    }
    const sketch = readStr(input.sketch);

    // Already-known capability? Short-circuit with a helpful pointer.
    const existing = findCapability(integration) ?? findCapability(`channel:${integration}`);
    if (existing) {
      return {
        ok: false,
        error: `Capability "${integration}" already exists in the catalog (${existing.id}, ${existing.kind}). Pivot the plan to use it instead of requesting a new one.`,
      };
    }

    const request: CapabilityRequest = {
      id: `cap-${randomUUID().slice(0, 8)}`,
      projectId: project.id,
      taskId: task.id,
      integration,
      why,
      ...(sketch ? { sketch } : {}),
      createdAt: opts.now ? opts.now() : new Date().toISOString(),
      status: "open",
    };
    try {
      await appendCapabilityRequest(request);
    } catch (err) {
      return {
        ok: false,
        error: `failed to record capability request: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (opts.auditLogPath) {
      emitProjectsAuditEvent(
        {
          kind: "projects.capability.requested",
          payload: {
            projectId: project.id,
            taskId: task.id,
            requestId: request.id,
            integration,
            why,
            ...(sketch ? { sketch } : {}),
          },
        },
        { auditLogPath: opts.auditLogPath },
      );
    }

    // Flip parent project to "needs-input" so the operator notices the
    // gap. The goal-loop hook won't re-fire the planner on a project in
    // "needs-input" because the pickup loop skips non-active projects.
    saveProject(opts.projectsDir, {
      ...project,
      status: "needs-input",
      metadata: {
        ...(project.metadata ?? {}),
        lastEvaluation: `Needs capability: ${integration}. Reason: ${why}`,
        pendingCapabilityRequestId: request.id,
      },
    });

    return {
      ok: true,
      result: {
        capabilityRequested: {
          id: request.id,
          integration,
          why,
          ...(sketch ? { sketch } : {}),
        },
      },
    };
  };
}

function readStr(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
