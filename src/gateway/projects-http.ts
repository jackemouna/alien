import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { AlienConfig } from "../config/types.alien.js";
import { listExperts } from "../experts/registry.js";
import { logWarn } from "../logger.js";
import { createAnthropicLlmClient } from "../orchestrator/llm-client.js";
import { emitProjectsAuditEvent } from "../projects/audit.js";
import { persistPlan, plan } from "../projects/planner.js";
import {
  deleteProject,
  listProjectIds,
  listTasks,
  loadProject,
  loadTask,
  saveProject,
  saveTask,
} from "../projects/store.js";
import { approveTaskForQueue, markTaskBlocked, resetTaskForRetry } from "../projects/task-state.js";
import type { Project, ProjectChannelBinding, TaskOrigin } from "../projects/types.js";
import { runAsHttp } from "../security/origin-context.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { sendJson } from "./http-common.js";
import { handleGatewayPostJsonEndpoint } from "./http-endpoint-helpers.js";
import {
  authorizeGatewayHttpRequestOrReply,
  resolveOpenAiCompatibleHttpOperatorScopes,
} from "./http-utils.js";
import { authorizeOperatorScopesForMethod } from "./method-scopes.js";
import { ensureProjectsRuntimeStarted } from "./projects-runtime-singleton.js";

/**
 * HTTP API for Projects + Tasks. Backs the Kanban UI in
 * ui/src/ui/views/projects.ts.
 *
 *   GET  /v1/projects                              — list (newest first)
 *   POST /v1/projects                              — create a project
 *   GET  /v1/projects/:id                          — project + all tasks
 *   DELETE /v1/projects/:id                        — archive (sets status=archived)
 *   POST /v1/projects/:id/tasks/from-prompt        — planner emits task DAG
 *   POST /v1/projects/:id/tasks/:taskId/approve    — backlog → queued
 *   POST /v1/projects/:id/tasks/:taskId/retry      — reset to queued
 *   POST /v1/projects/:id/tasks/:taskId/block      — mark blocked (operator note)
 *
 * Auth: same shared-token treatment as the orchestrator routes. Bearer auth
 * counts as full operator scope. Origin context for asynchronous planner
 * work is `http:projects-plan` so audit-log entries show the entry point.
 */

export type ProjectsHttpOptions = {
  readonly auth: ResolvedGatewayAuth;
  /**
   * Loaded gateway config. Used to lazily boot the Projects runtime
   * (auto-pickup loop + channel-inbox listener) on first HTTP touch so
   * the workforce starts running even when the gateway boot path has not
   * been updated to start it eagerly.
   */
  readonly cfg?: AlienConfig;
  readonly maxBodyBytes?: number;
  readonly trustedProxies?: readonly string[];
  readonly allowRealIpFallback?: boolean;
  readonly rateLimiter?: AuthRateLimiter;
};

const DEFAULT_BODY_BYTES = 256 * 1024;

export function isProjectsPath(pathname: string): boolean {
  return pathname === "/v1/projects" || pathname.startsWith("/v1/projects/");
}

export async function handleProjectsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectsHttpOptions,
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  const route = parseProjectsRoute(method, pathname);
  if (!route) return false;

  // First-touch boot: starts the auto-pickup loop and channel-inbox
  // listener if the gateway boot path has not started them eagerly.
  // Idempotent — subsequent requests see the cached singleton.
  if (opts.cfg) {
    void ensureProjectsRuntimeStarted({ cfg: opts.cfg });
  }

  switch (route.kind) {
    case "list":
      return await handleListProjects(req, res, opts);
    case "create":
      return await handleCreateProject(req, res, opts);
    case "get":
      return await handleGetProject(req, res, opts, route.projectId);
    case "archive":
      return await handleArchiveProject(req, res, opts, route.projectId);
    case "from-prompt":
      return await handleFromPrompt(req, res, opts, route.projectId);
    case "commit-plan":
      return await handleCommitPlan(req, res, opts, route.projectId);
    case "approve":
      return await handleApproveTask(req, res, opts, route.projectId, route.taskId);
    case "retry":
      return await handleRetryTask(req, res, opts, route.projectId, route.taskId);
    case "block":
      return await handleBlockTask(req, res, opts, route.projectId, route.taskId);
  }
}

type ProjectsRoute =
  | { readonly kind: "list" | "create" }
  | {
      readonly kind: "get" | "archive" | "from-prompt" | "commit-plan";
      readonly projectId: string;
    }
  | {
      readonly kind: "approve" | "retry" | "block";
      readonly projectId: string;
      readonly taskId: string;
    };

function parseProjectsRoute(method: string, pathname: string): ProjectsRoute | undefined {
  if (pathname === "/v1/projects") {
    if (method === "GET") return { kind: "list" };
    if (method === "POST") return { kind: "create" };
    return undefined;
  }
  if (!pathname.startsWith("/v1/projects/")) return undefined;
  const tail = pathname.slice("/v1/projects/".length);
  const segments = tail.split("/").filter(Boolean);
  if (segments.length === 1) {
    if (method === "GET") return { kind: "get", projectId: segments[0]! };
    if (method === "DELETE") return { kind: "archive", projectId: segments[0]! };
    return undefined;
  }
  if (segments.length === 3 && segments[1] === "tasks" && method === "POST") {
    if (segments[2] === "from-prompt") {
      return { kind: "from-prompt", projectId: segments[0]! };
    }
    if (segments[2] === "commit-plan") {
      return { kind: "commit-plan", projectId: segments[0]! };
    }
    return undefined;
  }
  if (segments.length === 4 && segments[1] === "tasks" && method === "POST") {
    const action = segments[3];
    if (action === "approve" || action === "retry" || action === "block") {
      return { kind: action, projectId: segments[0]!, taskId: segments[2]! };
    }
  }
  return undefined;
}

async function authorizeGetForProjects(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectsHttpOptions,
): Promise<boolean> {
  const requestAuth = await authorizeGatewayHttpRequestOrReply({
    req,
    res,
    auth: opts.auth,
    ...(opts.trustedProxies ? { trustedProxies: [...opts.trustedProxies] } : {}),
    ...(opts.allowRealIpFallback !== undefined
      ? { allowRealIpFallback: opts.allowRealIpFallback }
      : {}),
    ...(opts.rateLimiter ? { rateLimiter: opts.rateLimiter } : {}),
  });
  if (!requestAuth) return false;
  const requestedScopes = resolveOpenAiCompatibleHttpOperatorScopes(req, requestAuth);
  const scopeAuth = authorizeOperatorScopesForMethod("chat.send", requestedScopes);
  if (!scopeAuth.allowed) {
    sendJson(res, 403, {
      ok: false,
      error: { type: "forbidden", message: `missing scope: ${scopeAuth.missingScope}` },
    });
    return false;
  }
  return true;
}

async function readPostBody(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectsHttpOptions,
): Promise<Record<string, unknown> | undefined> {
  const handled = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: req.url ?? "",
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
  if (handled === false || !handled) return undefined;
  return (handled.body as Record<string, unknown> | null) ?? {};
}

async function handleListProjects(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectsHttpOptions,
): Promise<boolean> {
  if (!(await authorizeGetForProjects(req, res, opts))) return true;
  const projectsDir = resolveProjectsDir();
  const ids = listProjectIds(projectsDir);
  const projects = ids
    .map((id) => loadProject(projectsDir, id))
    .filter((p): p is Project => p !== null)
    .toSorted((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  sendJson(res, 200, { projects });
  return true;
}

async function handleGetProject(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectsHttpOptions,
  projectId: string,
): Promise<boolean> {
  if (!(await authorizeGetForProjects(req, res, opts))) return true;
  if (!isSafeId(projectId)) {
    sendJson(res, 400, { error: { message: "invalid project id", type: "invalid_request_error" } });
    return true;
  }
  const projectsDir = resolveProjectsDir();
  const project = loadProject(projectsDir, projectId);
  if (!project) {
    sendJson(res, 404, {
      error: { message: `project not found: ${projectId}`, type: "invalid_request_error" },
    });
    return true;
  }
  const tasks = listTasks(projectsDir, projectId);
  sendJson(res, 200, { project, tasks });
  return true;
}

async function handleCreateProject(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectsHttpOptions,
): Promise<boolean> {
  const body = await readPostBody(req, res, opts);
  if (!body) return true;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  const owner = typeof body.owner === "string" ? body.owner.trim() : "operator";
  if (!name) {
    sendJson(res, 400, {
      error: { message: "name is required", type: "invalid_request_error" },
    });
    return true;
  }
  const requestedId = typeof body.id === "string" && isSafeId(body.id) ? body.id : undefined;
  const projectId = requestedId ?? `proj-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const channels = parseChannels(body.channels);
  const project: Project = {
    id: projectId,
    name,
    goal: goal || name,
    owner,
    createdAt: new Date().toISOString(),
    status: "active",
    channels,
  };
  const projectsDir = resolveProjectsDir();
  saveProject(projectsDir, project);
  emitAudit("projects.project.created", {
    projectId,
    name,
    owner,
    channels: channels.map((c) => c.channel),
  });
  sendJson(res, 201, { project });
  return true;
}

async function handleArchiveProject(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectsHttpOptions,
  projectId: string,
): Promise<boolean> {
  if (!(await authorizeGetForProjects(req, res, opts))) return true;
  if (!isSafeId(projectId)) {
    sendJson(res, 400, { error: { message: "invalid project id", type: "invalid_request_error" } });
    return true;
  }
  const projectsDir = resolveProjectsDir();
  const project = loadProject(projectsDir, projectId);
  if (!project) {
    sendJson(res, 404, {
      error: { message: `project not found: ${projectId}`, type: "invalid_request_error" },
    });
    return true;
  }
  const archived: Project = { ...project, status: "archived" };
  saveProject(projectsDir, archived);
  emitAudit("projects.project.archived", { projectId });
  sendJson(res, 200, { project: archived });
  return true;
}

async function handleFromPrompt(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectsHttpOptions,
  projectId: string,
): Promise<boolean> {
  const body = await readPostBody(req, res, opts);
  if (!body) return true;
  if (!isSafeId(projectId)) {
    sendJson(res, 400, { error: { message: "invalid project id", type: "invalid_request_error" } });
    return true;
  }
  const projectsDir = resolveProjectsDir();
  const project = loadProject(projectsDir, projectId);
  if (!project) {
    sendJson(res, 404, {
      error: { message: `project not found: ${projectId}`, type: "invalid_request_error" },
    });
    return true;
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    sendJson(res, 400, {
      error: { message: "prompt is required", type: "invalid_request_error" },
    });
    return true;
  }
  const origin: TaskOrigin = { kind: "operator" };
  // Preview mode (default for the UI). The planner runs synchronously
  // and the response carries the proposed task DAG. Nothing is persisted
  // until the client follows up with /tasks/commit-plan. The legacy
  // fire-and-forget path is kept for callers that pass preview=false.
  const isPreview = body.preview !== false;

  let llm: Awaited<ReturnType<typeof createAnthropicLlmClient>>;
  try {
    llm = await createAnthropicLlmClient({});
  } catch (err) {
    sendJson(res, 400, {
      error: { message: stringifyError(err), type: "invalid_request_error" },
    });
    return true;
  }

  // Resolve the assigned expert roster so the planner can route each
  // task to a named expert. Falls back to the full bundled roster when
  // the project doesn't have an explicit assignment.
  const allExperts = await listExperts();
  const projectForExperts = loadProject(projectsDir, projectId);
  const assignedIds = new Set(projectForExperts?.assignedExperts ?? allExperts.map((e) => e.id));
  const availableExperts = allExperts.filter((e) => assignedIds.has(e.id));

  if (isPreview) {
    try {
      const result = await runAsHttp("projects-plan-preview", { projectId }, async () => {
        const existing = listTasks(projectsDir, projectId);
        return await plan({ projectId, prompt, origin, existing }, { llm, availableExperts });
      });
      sendJson(res, 200, { plan: result });
    } catch (err) {
      sendJson(res, 400, {
        error: { message: stringifyError(err), type: "invalid_request_error" },
      });
    }
    return true;
  }

  void runAsHttp("projects-plan", { projectId }, async () => {
    try {
      const existing = listTasks(projectsDir, projectId);
      const result = await plan({ projectId, prompt, origin, existing }, { llm, availableExperts });
      const auditLogPath = resolveAuditLogPath();
      persistPlan(projectId, result, {
        projectsDir,
        origin,
        ...(auditLogPath ? { auditLogPath } : {}),
      });
    } catch (err) {
      logWarn(`projects-http: plan for ${projectId} failed: ${stringifyError(err)}`);
    }
  });

  sendJson(res, 202, { projectId, accepted: true });
  return true;
}

async function handleCommitPlan(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectsHttpOptions,
  projectId: string,
): Promise<boolean> {
  const body = await readPostBody(req, res, opts);
  if (!body) return true;
  if (!isSafeId(projectId)) {
    sendJson(res, 400, { error: { message: "invalid project id", type: "invalid_request_error" } });
    return true;
  }
  const projectsDir = resolveProjectsDir();
  const project = loadProject(projectsDir, projectId);
  if (!project) {
    sendJson(res, 404, {
      error: { message: `project not found: ${projectId}`, type: "invalid_request_error" },
    });
    return true;
  }
  const planBody = body.plan as unknown;
  if (
    !planBody ||
    typeof planBody !== "object" ||
    !Array.isArray((planBody as { tasks?: unknown }).tasks)
  ) {
    sendJson(res, 400, {
      error: { message: "plan.tasks[] is required", type: "invalid_request_error" },
    });
    return true;
  }
  const planResult = planBody as {
    summary?: string;
    tasks: ReadonlyArray<Record<string, unknown>>;
  };
  if (planResult.tasks.length === 0) {
    sendJson(res, 400, {
      error: { message: "plan must include at least one task", type: "invalid_request_error" },
    });
    return true;
  }
  // Surviving-set sanitization. After UI-side edits a depended-on task
  // may no longer exist in the submitted plan; strip those orphan refs.
  const presentLocalIds = new Set(
    planResult.tasks
      .map((t) => {
        const value = t._localId ?? t.id;
        return typeof value === "string" ? value : "";
      })
      .filter(Boolean),
  );
  const sanitizedTasks: Array<Record<string, unknown>> = [];
  for (const raw of planResult.tasks) {
    if (!raw || typeof raw !== "object") continue;
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    const role = typeof raw.role === "string" ? raw.role.trim() : "";
    if (!title || !description || !role) continue;
    const dependsOn = Array.isArray(raw.dependsOn)
      ? (raw.dependsOn as unknown[]).filter(
          (d): d is string => typeof d === "string" && presentLocalIds.has(d),
        )
      : [];
    sanitizedTasks.push({ ...raw, dependsOn });
  }
  if (sanitizedTasks.length === 0) {
    sendJson(res, 400, {
      error: { message: "no valid tasks in plan", type: "invalid_request_error" },
    });
    return true;
  }
  const origin: TaskOrigin = { kind: "operator" };
  const auditLogPath = resolveAuditLogPath();
  try {
    const created = persistPlan(
      projectId,
      // The persistPlan helper expects a PlanResult-shape with tasks
      // matching TaskDraft. The fields it reads (title, description,
      // role, dependsOn, input, priority, requiresApproval) are exactly
      // what the UI roundtrips through preview → commit, so a cast is
      // safe here.
      { tasks: sanitizedTasks as unknown as Parameters<typeof persistPlan>[1]["tasks"] },
      {
        projectsDir,
        origin,
        ...(auditLogPath ? { auditLogPath } : {}),
      },
    );
    sendJson(res, 201, { committed: true, taskCount: created.length });
  } catch (err) {
    sendJson(res, 400, {
      error: { message: stringifyError(err), type: "invalid_request_error" },
    });
  }
  return true;
}

async function handleApproveTask(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectsHttpOptions,
  projectId: string,
  taskId: string,
): Promise<boolean> {
  if (!(await authorizeGetForProjects(req, res, opts))) return true;
  if (!isSafeId(projectId) || !isSafeId(taskId)) {
    sendJson(res, 400, { error: { message: "invalid id", type: "invalid_request_error" } });
    return true;
  }
  const projectsDir = resolveProjectsDir();
  const task = loadTask(projectsDir, projectId, taskId);
  if (!task) {
    sendJson(res, 404, {
      error: { message: `task not found: ${taskId}`, type: "invalid_request_error" },
    });
    return true;
  }
  if (task.status !== "backlog") {
    sendJson(res, 409, {
      error: { message: `task is not in backlog (status=${task.status})`, type: "conflict" },
    });
    return true;
  }
  const next = approveTaskForQueue(task);
  saveTask(projectsDir, next);
  emitAudit("projects.task.approved", { projectId, taskId });
  sendJson(res, 200, { task: next });
  return true;
}

async function handleRetryTask(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectsHttpOptions,
  projectId: string,
  taskId: string,
): Promise<boolean> {
  if (!(await authorizeGetForProjects(req, res, opts))) return true;
  if (!isSafeId(projectId) || !isSafeId(taskId)) {
    sendJson(res, 400, { error: { message: "invalid id", type: "invalid_request_error" } });
    return true;
  }
  const projectsDir = resolveProjectsDir();
  const task = loadTask(projectsDir, projectId, taskId);
  if (!task) {
    sendJson(res, 404, {
      error: { message: `task not found: ${taskId}`, type: "invalid_request_error" },
    });
    return true;
  }
  const next = resetTaskForRetry(task);
  saveTask(projectsDir, next);
  emitAudit("projects.task.queued", { projectId, taskId });
  sendJson(res, 200, { task: next });
  return true;
}

async function handleBlockTask(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectsHttpOptions,
  projectId: string,
  taskId: string,
): Promise<boolean> {
  const body = await readPostBody(req, res, opts);
  if (!body) return true;
  if (!isSafeId(projectId) || !isSafeId(taskId)) {
    sendJson(res, 400, { error: { message: "invalid id", type: "invalid_request_error" } });
    return true;
  }
  const projectsDir = resolveProjectsDir();
  const task = loadTask(projectsDir, projectId, taskId);
  if (!task) {
    sendJson(res, 404, {
      error: { message: `task not found: ${taskId}`, type: "invalid_request_error" },
    });
    return true;
  }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason : "blocked";
  const next = markTaskBlocked(task, reason);
  saveTask(projectsDir, next);
  emitAudit("projects.task.blocked", { projectId, taskId, reason });
  sendJson(res, 200, { task: next });
  return true;
}

function parseChannels(raw: unknown): ProjectChannelBinding[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectChannelBinding[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const channel = typeof e.channel === "string" ? e.channel.trim() : "";
    if (!channel) continue;
    const binding: ProjectChannelBinding = { channel };
    if (typeof e.accountId === "string" && e.accountId.trim()) {
      (binding as { accountId?: string }).accountId = e.accountId;
    }
    if (typeof e.defaultThreadId === "string" && e.defaultThreadId.trim()) {
      (binding as { defaultThreadId?: string }).defaultThreadId = e.defaultThreadId;
    }
    out.push(binding);
  }
  return out;
}

function emitAudit(
  kind: Parameters<typeof emitProjectsAuditEvent>[0]["kind"],
  payload: Record<string, unknown>,
): void {
  const auditLogPath = resolveAuditLogPath();
  if (!auditLogPath) return;
  emitProjectsAuditEvent({ kind, payload }, { auditLogPath });
}

function resolveProjectsDir(): string {
  return path.join(resolveStateDir(process.env), "projects");
}

function resolveAuditLogPath(): string | undefined {
  if (process.env.ALIEN_DISABLE_AUDIT_LOG === "1") return undefined;
  return path.join(resolveStateDir(process.env), "audit.log");
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(id);
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
