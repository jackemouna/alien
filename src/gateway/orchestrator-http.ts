import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { logWarn } from "../logger.js";
import { createAnthropicLlmClient } from "../orchestrator/llm-client.js";
import { createRunFromWorkflow } from "../orchestrator/run-state.js";
import { listRunIds, loadRun, resolveRunPath } from "../orchestrator/run-store.js";
import { runOrchestratorRun } from "../orchestrator/runner.js";
import type { Run } from "../orchestrator/types.js";
import { createDailyResearchWorkers } from "../orchestrator/workers.js";
import { planDailyResearchWorkflow } from "../orchestrator/workflows/daily-research.js";
import { runAsHttp } from "../security/origin-context.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { sendJson } from "./http-common.js";
import { handleGatewayPostJsonEndpoint } from "./http-endpoint-helpers.js";
import { resolveOpenAiCompatibleHttpOperatorScopes } from "./http-utils.js";

/**
 * HTTP API for the orchestrator MVP. Three routes:
 *
 *   GET  /v1/orchestrator/runs            — list runs (newest first)
 *   GET  /v1/orchestrator/runs/<runId>    — fetch a single run
 *   POST /v1/orchestrator/runs            — start a new daily-research run
 *
 * The Lit `app-orchestrator` view uses GET /list for the list page and
 * GET /<runId> for live status (polled every 2s during a run). POST returns
 * the runId immediately and runs the workflow asynchronously; the runner
 * persists state to disk so the GET polling sees task transitions in real
 * time.
 *
 * Auth: same shared-token treatment as /v1/chat/completions — bearer auth
 * counts as full operator scope on this surface. Audit-log entries from
 * the runner carry `origin: "http:orchestrator-run"` so a reviewer can
 * tell whether a run was triggered from the operator CLI, the Mac app
 * (via CLI subprocess), or the gateway web UI.
 */

export type OrchestratorHttpOptions = {
  readonly auth: ResolvedGatewayAuth;
  readonly maxBodyBytes?: number;
  readonly trustedProxies?: readonly string[];
  readonly allowRealIpFallback?: boolean;
  readonly rateLimiter?: AuthRateLimiter;
};

const DEFAULT_BODY_BYTES = 1 * 1024 * 1024;

export function isOrchestratorRunsPath(pathname: string): boolean {
  return pathname === "/v1/orchestrator/runs" || pathname.startsWith("/v1/orchestrator/runs/");
}

export async function handleOrchestratorRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OrchestratorHttpOptions,
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/v1/orchestrator/runs") {
    return await handleListRuns(req, res, opts);
  }
  if (method === "GET" && pathname.startsWith("/v1/orchestrator/runs/")) {
    const runId = pathname.slice("/v1/orchestrator/runs/".length);
    return await handleGetRun(req, res, opts, runId);
  }
  if (method === "POST" && pathname === "/v1/orchestrator/runs") {
    return await handleStartRun(req, res, opts);
  }
  return false;
}

async function handleListRuns(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OrchestratorHttpOptions,
): Promise<boolean> {
  const handled = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: "/v1/orchestrator/runs",
    method: "GET",
    requiredOperatorMethod: "chat.send",
    resolveOperatorScopes: resolveOpenAiCompatibleHttpOperatorScopes,
    auth: opts.auth,
    ...(opts.trustedProxies ? { trustedProxies: [...opts.trustedProxies] } : {}),
    ...(opts.allowRealIpFallback !== undefined
      ? { allowRealIpFallback: opts.allowRealIpFallback }
      : {}),
    ...(opts.rateLimiter ? { rateLimiter: opts.rateLimiter } : {}),
    maxBodyBytes: 0,
  });
  if (handled === false) return false;
  if (!handled) return true;

  const orchestratorDir = resolveOrchestratorDir();
  const ids = listRunIds(orchestratorDir);
  const runs = ids
    .map((id) => loadRun(orchestratorDir, id))
    .filter((run): run is Run => run !== null)
    .toSorted((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  sendJson(res, 200, { runs });
  return true;
}

async function handleGetRun(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OrchestratorHttpOptions,
  runId: string,
): Promise<boolean> {
  const handled = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: req.url ?? `/v1/orchestrator/runs/${runId}`,
    method: "GET",
    requiredOperatorMethod: "chat.send",
    resolveOperatorScopes: resolveOpenAiCompatibleHttpOperatorScopes,
    auth: opts.auth,
    ...(opts.trustedProxies ? { trustedProxies: [...opts.trustedProxies] } : {}),
    ...(opts.allowRealIpFallback !== undefined
      ? { allowRealIpFallback: opts.allowRealIpFallback }
      : {}),
    ...(opts.rateLimiter ? { rateLimiter: opts.rateLimiter } : {}),
    maxBodyBytes: 0,
  });
  if (handled === false) return false;
  if (!handled) return true;

  if (!isSafeRunId(runId)) {
    sendJson(res, 400, { error: { message: "invalid run id", type: "invalid_request_error" } });
    return true;
  }
  const run = loadRun(resolveOrchestratorDir(), runId);
  if (!run) {
    sendJson(res, 404, {
      error: { message: `run not found: ${runId}`, type: "invalid_request_error" },
    });
    return true;
  }
  sendJson(res, 200, { run });
  return true;
}

async function handleStartRun(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OrchestratorHttpOptions,
): Promise<boolean> {
  const handled = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: "/v1/orchestrator/runs",
    requiredOperatorMethod: "chat.send",
    resolveOperatorScopes: resolveOpenAiCompatibleHttpOperatorScopes,
    auth: opts.auth,
    ...(opts.trustedProxies ? { trustedProxies: [...opts.trustedProxies] } : {}),
    ...(opts.allowRealIpFallback !== undefined
      ? { allowRealIpFallback: opts.allowRealIpFallback }
      : {}),
    ...(opts.rateLimiter ? { rateLimiter: opts.rateLimiter } : {}),
    maxBodyBytes: opts.maxBodyBytes ?? DEFAULT_BODY_BYTES,
  });
  if (handled === false) return false;
  if (!handled) return true;

  const body = handled.body as Record<string, unknown> | null;
  const topicsRaw = body?.topics;
  const topics = Array.isArray(topicsRaw)
    ? topicsRaw.map((t) => String(t).trim()).filter(Boolean)
    : typeof topicsRaw === "string"
      ? topicsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
  if (topics.length === 0) {
    sendJson(res, 400, {
      error: { message: "topics is required (string or string[])", type: "invalid_request_error" },
    });
    return true;
  }
  const title = typeof body?.title === "string" && body.title.trim() ? body.title : "Daily Brief";
  const wordTarget =
    typeof body?.wordTarget === "number" && Number.isFinite(body.wordTarget)
      ? Math.max(40, Math.min(600, Math.round(body.wordTarget)))
      : 120;
  const requestedRunId =
    typeof body?.runId === "string" && isSafeRunId(body.runId) ? body.runId : undefined;
  const runId = requestedRunId ?? `run-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const orchestratorDir = resolveOrchestratorDir();
  const stateDir = resolveStateDir(process.env);
  const outputPath =
    typeof body?.outputPath === "string" && body.outputPath.trim()
      ? body.outputPath
      : path.join(orchestratorDir, "runs", `${runId}.md`);
  const auditLogPath = path.join(stateDir, "audit.log");

  let llm: Awaited<ReturnType<typeof createAnthropicLlmClient>>;
  try {
    llm = await createAnthropicLlmClient({});
  } catch (err) {
    sendJson(res, 400, {
      error: { message: stringifyError(err), type: "invalid_request_error" },
    });
    return true;
  }
  const workers = createDailyResearchWorkers({ llm });

  const workflow = planDailyResearchWorkflow({
    runId,
    topics,
    outputPath,
    title,
    wordTarget,
  });
  const run = createRunFromWorkflow({ runId, workflow });

  // Fire-and-forget the run so the POST returns immediately with the runId.
  // The runner persists state after every transition; the client polls
  // GET /v1/orchestrator/runs/<runId> for live status.
  void runAsHttp("orchestrator-run", { runId }, async () => {
    try {
      await runOrchestratorRun(run, workers, {
        orchestratorDir,
        auditLogPath: process.env.ALIEN_DISABLE_AUDIT_LOG === "1" ? undefined : auditLogPath,
      });
    } catch (err) {
      logWarn(`orchestrator-http: run ${runId} crashed: ${stringifyError(err)}`);
    }
  });

  sendJson(res, 202, {
    runId,
    workflowId: workflow.id,
    runPath: resolveRunPath(orchestratorDir, runId),
    outputPath,
  });
  return true;
}

function resolveOrchestratorDir(): string {
  return path.join(resolveStateDir(process.env), "orchestrator");
}

function isSafeRunId(runId: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(runId);
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
