import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { logWarn } from "../logger.js";
import {
  readActivatedCapabilities,
  resolveActivatedCapabilitiesPath,
} from "../projects/activated-capabilities-store.js";
import { emitProjectsAuditEvent } from "../projects/audit.js";
import {
  activateCapability,
  deactivateCapability,
  readReasoningTrace,
} from "../projects/capability-activator.js";
import { readCapabilityRequests } from "../projects/capability-requests-store.js";
import { saveProject, saveTask } from "../projects/store.js";
import { createTaskRecord } from "../projects/task-state.js";
import type { Project, TaskDraft } from "../projects/types.js";
import type { ResolvedGatewayAuth } from "./auth-resolve.js";
import { sendJson } from "./http-common.js";
import { handleGatewayPostJsonEndpoint } from "./http-endpoint-helpers.js";
import { getActiveCapabilityRuntimeLoader } from "./projects-runtime.js";

/**
 * Capability operations (Phase C). One endpoint for now:
 *
 *   POST /v1/capabilities/:requestId/build
 *     → creates a side project containing a single self-coder task that
 *       reads the capability request, asks the LLM to generate the
 *       scaffold, and writes it under
 *       `${state-dir}/extensions-generated/<integration>/`. The pickup
 *       loop picks the task up on its next tick. Operator must review
 *       before activation (Phase D / E).
 *
 *   GET  /v1/capabilities
 *     → list current capability requests (status + integration), so the
 *       UI can render an "open requests" surface.
 *
 * Both endpoints require a gateway bearer token (operator scope).
 */

export type CapabilitiesHttpOptions = {
  readonly auth: ResolvedGatewayAuth;
  readonly maxBodyBytes?: number;
  readonly trustedProxies?: string[];
  readonly allowRealIpFallback?: boolean;
};

const DEFAULT_MAX_BODY_BYTES = 4096;

export function isCapabilitiesPath(pathname: string): boolean {
  if (pathname === "/v1/capabilities") return true;
  if (pathname === "/v1/capabilities/activated") return true;
  return /^\/v1\/capabilities\/[^/]+\/(build|activate|deactivate|trace)$/.test(pathname);
}

export async function handleCapabilitiesRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: CapabilitiesHttpOptions,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isCapabilitiesPath(pathname)) return false;

  if (pathname === "/v1/capabilities") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    try {
      const requests = await readCapabilityRequests();
      sendJson(res, 200, {
        requests: requests.map((r) => ({
          id: r.id,
          projectId: r.projectId,
          integration: r.integration,
          why: r.why,
          status: r.status,
          createdAt: r.createdAt,
          ...(r.sketch ? { sketch: r.sketch } : {}),
          ...(r.resolution ? { resolution: r.resolution } : {}),
        })),
      });
    } catch (err) {
      sendJson(res, 500, {
        error: { message: err instanceof Error ? err.message : String(err) },
      });
    }
    return true;
  }

  if (pathname === "/v1/capabilities/activated") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    try {
      const activated = await readActivatedCapabilities();
      sendJson(res, 200, {
        activated: activated.map((a) => ({
          id: a.id,
          integration: a.integration,
          fromRequestId: a.fromRequestId,
          activatedAt: a.activatedAt,
          activatedBy: a.activatedBy,
          status: a.status,
          ...(a.rollbackAt ? { rollbackAt: a.rollbackAt } : {}),
          ...(a.rollbackReason ? { rollbackReason: a.rollbackReason } : {}),
        })),
        store: resolveActivatedCapabilitiesPath(),
      });
    } catch (err) {
      sendJson(res, 500, { error: { message: err instanceof Error ? err.message : String(err) } });
    }
    return true;
  }

  const traceMatch = pathname.match(/^\/v1\/capabilities\/([^/]+)\/trace$/);
  if (traceMatch) {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    try {
      const requestId = decodeURIComponent(traceMatch[1] ?? "");
      const trace = await readReasoningTrace(requestId);
      sendJson(res, trace.request ? 200 : 404, trace);
    } catch (err) {
      sendJson(res, 500, { error: { message: err instanceof Error ? err.message : String(err) } });
    }
    return true;
  }

  const activateMatch = pathname.match(/^\/v1\/capabilities\/([^/]+)\/activate$/);
  if (activateMatch) {
    const requestId = decodeURIComponent(activateMatch[1] ?? "");
    const handshake = await handleGatewayPostJsonEndpoint(req, res, {
      pathname,
      auth: opts.auth,
      maxBodyBytes: opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
      ...(opts.trustedProxies ? { trustedProxies: opts.trustedProxies } : {}),
      ...(opts.allowRealIpFallback !== undefined
        ? { allowRealIpFallback: opts.allowRealIpFallback }
        : {}),
    });
    if (handshake === false || handshake === undefined) return true;
    const auditLogPath = path.join(resolveStateDir(), "audit.log");
    const loader = getActiveCapabilityRuntimeLoader();
    const outcome = await activateCapability(requestId, {
      auditLogPath,
      ...(loader ? { loader } : {}),
    });
    if (!outcome.ok) {
      sendJson(res, 400, { ok: false, error: outcome.error });
      return true;
    }
    const liveNow = loader?.getCapability(outcome.record.id);
    sendJson(res, 200, {
      ok: true,
      record: outcome.record,
      newlyActivated: outcome.newlyActivated,
      hotLoaded: Boolean(liveNow),
      message: outcome.newlyActivated
        ? liveNow
          ? "Activated and hot-loaded into the running gateway."
          : "Activated, but hot-load did not complete — restart the gateway to load."
        : "Already active; no-op.",
    });
    return true;
  }

  const deactivateMatch = pathname.match(/^\/v1\/capabilities\/([^/]+)\/deactivate$/);
  if (deactivateMatch) {
    const requestId = decodeURIComponent(deactivateMatch[1] ?? "");
    const handshake = await handleGatewayPostJsonEndpoint(req, res, {
      pathname,
      auth: opts.auth,
      maxBodyBytes: opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
      ...(opts.trustedProxies ? { trustedProxies: opts.trustedProxies } : {}),
      ...(opts.allowRealIpFallback !== undefined
        ? { allowRealIpFallback: opts.allowRealIpFallback }
        : {}),
    });
    if (handshake === false || handshake === undefined) return true;
    const body = handshake.body as { reason?: unknown } | undefined;
    const reason =
      body && typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim()
        : undefined;
    const auditLogPath = path.join(resolveStateDir(), "audit.log");
    const loader = getActiveCapabilityRuntimeLoader();
    const outcome = await deactivateCapability(requestId, reason, {
      auditLogPath,
      ...(loader ? { loader } : {}),
    });
    if (!outcome.ok) {
      sendJson(res, 400, { ok: false, error: outcome.error });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      record: outcome.record,
      message:
        "Rolled back. Active-dir copy was removed; the sandbox copy remains for forensics. The cached module reference has been dropped from the running loader (Node ESM cannot truly unload — restart for a clean slate).",
    });
    return true;
  }

  const buildMatch = pathname.match(/^\/v1\/capabilities\/([^/]+)\/build$/);
  if (buildMatch) {
    const requestId = decodeURIComponent(buildMatch[1] ?? "");
    const handshake = await handleGatewayPostJsonEndpoint(req, res, {
      pathname,
      auth: opts.auth,
      maxBodyBytes: opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
      ...(opts.trustedProxies ? { trustedProxies: opts.trustedProxies } : {}),
      ...(opts.allowRealIpFallback !== undefined
        ? { allowRealIpFallback: opts.allowRealIpFallback }
        : {}),
    });
    if (handshake === false || handshake === undefined) return true;
    await handleBuildCapability(res, requestId);
    return true;
  }

  return false;
}

async function handleBuildCapability(res: ServerResponse, requestId: string): Promise<void> {
  if (!requestId) {
    sendJson(res, 400, { error: { message: "Missing requestId in path" } });
    return;
  }

  try {
    const requests = await readCapabilityRequests();
    const request = requests.find((r) => r.id === requestId);
    if (!request) {
      sendJson(res, 404, { error: { message: `Unknown capability request: ${requestId}` } });
      return;
    }
    if (request.status === "fulfilled") {
      sendJson(res, 409, {
        error: {
          message: `Capability request ${requestId} is already fulfilled. Inspect the prior output before regenerating.`,
        },
      });
      return;
    }

    const projectsDir = path.join(resolveStateDir(), "projects");
    const auditLogPath = path.join(resolveStateDir(), "audit.log");
    const now = () => new Date().toISOString();
    const projectId = `proj-build-${randomUUID().slice(0, 8)}`;
    const project: Project = {
      id: projectId,
      name: `Build: ${request.integration}`,
      goal: `Generate a stub extension for capability "${request.integration}". Reason: ${request.why}`,
      owner: "operator",
      createdAt: now(),
      status: "active",
      channels: [],
      metadata: { spawnedFromCapabilityRequest: request.id },
    };
    saveProject(projectsDir, project);
    emitProjectsAuditEvent(
      {
        kind: "projects.project.created",
        payload: {
          projectId,
          name: project.name,
          owner: project.owner,
          channelCount: 0,
          spawnedFromCapabilityRequest: request.id,
        },
      },
      { auditLogPath },
    );

    const draft: TaskDraft = {
      title: `Generate stub for ${request.integration}`,
      description: `Self-coder: read capability request ${request.id} and write the scaffold.`,
      role: "self-coder",
      dependsOn: [],
      input: { requestId: request.id },
      priority: "high",
    };
    const task = createTaskRecord({
      taskId: `task-${randomUUID().slice(0, 8)}`,
      projectId,
      draft,
      origin: { kind: "operator" },
      now,
    });
    saveTask(projectsDir, task);
    emitProjectsAuditEvent(
      {
        kind: "projects.task.created",
        payload: {
          projectId,
          taskId: task.id,
          role: task.role,
          priority: task.priority,
          requiresApproval: false,
          originKind: "operator",
        },
      },
      { auditLogPath },
    );

    sendJson(res, 200, {
      ok: true,
      projectId,
      taskId: task.id,
      message:
        "Self-coder task queued. The pickup loop will run it on its next tick; the project transitions to 'review' once generation completes for operator approval.",
    });
  } catch (err) {
    logWarn(`capabilities-http: build failed: ${err instanceof Error ? err.message : String(err)}`);
    sendJson(res, 500, {
      error: { message: err instanceof Error ? err.message : String(err) },
    });
  }
}
