import { randomUUID } from "node:crypto";
import type { LlmClient } from "../orchestrator/llm-client.js";
import type { WorkerRole } from "../orchestrator/types.js";
import { emitProjectsAuditEvent } from "./audit.js";
import { saveTask, type ProjectStoreOptions } from "./store.js";
import { createTaskRecord } from "./task-state.js";
import type {
  PlanRequest,
  PlanResult,
  Priority,
  TaskDraft,
  TaskOrigin,
  TaskRecord,
} from "./types.js";

/**
 * Planner agent — the "CEO" that turns a free-form prompt into a small
 * task DAG on a Project board. v0.1 keeps the worker palette intentionally
 * small (the same orchestrator roles); v0.2 will extend with email-handler,
 * social-media-manager, calendar-keeper, crm-operator, etc.
 *
 * Output discipline: the LLM returns strict JSON in a known schema. We
 * validate, drop unrecognised roles, normalize ids/priorities, and never
 * trust the model to invent dependencies on tasks it didn't emit.
 */

const PLANNER_SYSTEM_PROMPT = `You are the planner agent for Alien — an AI-powered workforce.
You receive a request and must break it into a small set of tasks that
specialist workers will execute.

The available worker roles are exactly:
- researcher: gathers facts about a topic.
- writer: produces a draft from research / inputs.
- editor: revises drafts for quality and consistency.
- publisher: writes the final artifact to disk or sends it to a channel.
- email-handler: reads the user's Gmail inbox, drafts replies, and sends mail.
  Task input shape for email-handler:
    { "action": "list_inbox", "query": "is:unread newer_than:1d", "maxResults": 10 }
    { "action": "send", "to": "...", "subject": "...", "bodyText": "..." }
    { "action": "draft_reply", "inReplyToMessageId": "...",
      "replyPrompt": "Politely decline; suggest next week." }

Hard rules:
1. Respond with strict JSON only, no prose, no markdown fence.
2. Schema:
   {
     "summary": "<one-line plain-English summary>",
     "tasks": [
       {
         "id": "<short kebab id, unique in this plan>",
         "title": "<one-line>",
         "description": "<two-sentence what to do>",
         "role": "researcher" | "writer" | "editor" | "publisher" | "email-handler",
         "dependsOn": ["<id of another task in this list>", ...],
         "input": { ...arbitrary JSON the worker needs... },
         "priority": "low" | "normal" | "high" | "urgent",
         "requiresApproval": true | false
       }
     ]
   }
3. Prefer fewer tasks (2–6) over many. Aim for the simplest plan that achieves the goal.
4. dependsOn must reference ids from the *same* response. Do NOT reference existing tasks.
5. Mark a task requiresApproval: true when the action has irreversible external
   effects (sending mail, posting to a channel, deleting). Reading and drafting
   are safe — leave them unapproved so the team can move fast.`;

const KNOWN_ROLES: readonly WorkerRole[] = [
  "researcher",
  "writer",
  "editor",
  "publisher",
  "email-handler",
] as const;

const KNOWN_PRIORITIES: readonly Priority[] = ["low", "normal", "high", "urgent"] as const;

const DEFAULT_MAX_TASKS = 8;

export type PlannerOptions = {
  readonly llm: LlmClient;
  readonly maxTasks?: number;
};

export function createPlanner(opts: PlannerOptions): (req: PlanRequest) => Promise<PlanResult> {
  return async (req) => plan(req, opts);
}

export async function plan(req: PlanRequest, opts: PlannerOptions): Promise<PlanResult> {
  const maxTasks = opts.maxTasks ?? DEFAULT_MAX_TASKS;
  const userPrompt = buildUserPrompt(req);
  const raw = await opts.llm.complete({
    system: PLANNER_SYSTEM_PROMPT,
    user: userPrompt,
    purpose: "planner",
    maxTokens: 1024,
  });
  return parsePlannerResponse(raw, maxTasks);
}

/**
 * Convenience: plan + persist + audit. Caller passes the projects dir and
 * an audit-log path; the helper creates TaskRecords with stable ids,
 * persists each, and emits one `projects.task.created` event per task.
 */
export type PersistPlanOptions = {
  readonly projectsDir: string;
  readonly auditLogPath?: string;
  readonly origin: TaskOrigin;
  readonly storeOptions?: ProjectStoreOptions;
  readonly now?: () => string;
  readonly idPrefix?: string;
};

export function persistPlan(
  projectId: string,
  result: PlanResult,
  opts: PersistPlanOptions,
): TaskRecord[] {
  const created: TaskRecord[] = [];
  const idPrefix = opts.idPrefix ?? `task-${shortId()}`;
  let i = 0;
  // Map planner's local ids to the final persistent task ids so dependsOn
  // edges survive normalization.
  const localIdToFinal = new Map<string, string>();
  for (const draft of result.tasks) {
    const localId = (draft as TaskDraft & { _localId?: string })._localId ?? `${idPrefix}-${i}`;
    localIdToFinal.set(localId, `${idPrefix}-${i}`);
    i += 1;
  }
  i = 0;
  for (const draft of result.tasks) {
    const finalId = `${idPrefix}-${i}`;
    const remappedDeps = draft.dependsOn
      .map((dep) => localIdToFinal.get(dep) ?? dep)
      .filter((dep) => dep !== finalId);
    const taskDraft: TaskDraft = {
      ...draft,
      dependsOn: remappedDeps,
    };
    const task = createTaskRecord({
      taskId: finalId,
      projectId,
      draft: taskDraft,
      origin: opts.origin,
      ...(opts.now ? { now: opts.now } : {}),
    });
    saveTask(opts.projectsDir, task, opts.storeOptions);
    if (opts.auditLogPath) {
      emitProjectsAuditEvent(
        {
          kind: "projects.task.created",
          payload: {
            projectId,
            taskId: task.id,
            role: task.role,
            priority: task.priority,
            requiresApproval: task.requiresApproval === true,
            originKind: task.origin.kind,
          },
        },
        { auditLogPath: opts.auditLogPath },
      );
    }
    created.push(task);
    i += 1;
  }
  return created;
}

function buildUserPrompt(req: PlanRequest): string {
  const existing =
    req.existing.length === 0
      ? "(none)"
      : req.existing.map((t) => `- ${t.id} [${t.status} / ${t.role}] ${t.title}`).join("\n");
  return `Project: ${req.projectId}
Origin: ${describeOrigin(req.origin)}

Existing tasks on this project (for context, do NOT redo them):
${existing}

New request from the operator/channel:
"""
${req.prompt}
"""

Emit the JSON plan now.`;
}

function describeOrigin(origin: TaskOrigin): string {
  if (origin.kind === "channel") {
    const display = origin.authorDisplayName ?? "unknown";
    return `channel:${origin.channel} (author: ${display})`;
  }
  if (origin.kind === "planner") {
    return `planner (parent runId: ${origin.runId})`;
  }
  return "operator";
}

export function parsePlannerResponse(raw: string, maxTasks: number): PlanResult {
  const trimmed = stripJsonFence(raw).trim();
  if (!trimmed) {
    throw new Error("planner returned an empty response");
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("planner response was not a JSON object");
  }
  const body = parsed as { summary?: unknown; tasks?: unknown };
  if (!Array.isArray(body.tasks)) {
    throw new Error("planner response missing tasks[]");
  }
  if (body.tasks.length === 0) {
    throw new Error("planner returned zero tasks");
  }
  if (body.tasks.length > maxTasks) {
    throw new Error(`planner returned ${body.tasks.length} tasks (max ${maxTasks})`);
  }

  const tasks: TaskDraft[] = [];
  const seenLocalIds = new Set<string>();
  for (const rawTask of body.tasks) {
    if (!rawTask || typeof rawTask !== "object") {
      throw new Error("planner task entry was not an object");
    }
    const t = rawTask as Record<string, unknown>;
    const localId = typeof t.id === "string" ? t.id.trim() : "";
    if (localId && seenLocalIds.has(localId)) {
      throw new Error(`planner emitted duplicate task id: ${localId}`);
    }
    if (localId) seenLocalIds.add(localId);
    const title = typeof t.title === "string" ? t.title.trim() : "";
    const description = typeof t.description === "string" ? t.description.trim() : "";
    const role = typeof t.role === "string" ? t.role.trim() : "";
    if (!title || !description || !role) {
      throw new Error("planner task missing title/description/role");
    }
    if (!(KNOWN_ROLES as readonly string[]).includes(role)) {
      throw new Error(`planner task referenced unknown role: ${role}`);
    }
    const dependsOn = Array.isArray(t.dependsOn)
      ? t.dependsOn.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [];
    const input =
      t.input && typeof t.input === "object" && !Array.isArray(t.input)
        ? (t.input as Record<string, unknown>)
        : {};
    const priorityRaw = typeof t.priority === "string" ? t.priority.trim() : "normal";
    const priority = (KNOWN_PRIORITIES as readonly string[]).includes(priorityRaw)
      ? (priorityRaw as Priority)
      : "normal";
    const requiresApproval = t.requiresApproval === true;
    const draft: TaskDraft = {
      title,
      description,
      role: role as WorkerRole,
      dependsOn,
      input,
      priority,
      ...(requiresApproval ? { requiresApproval: true } : {}),
    };
    // Carry the planner's local id as a private hint so persistPlan can
    // remap dependsOn edges from local-id-space to persistent-id-space.
    (draft as TaskDraft & { _localId?: string })._localId = localId || undefined;
    tasks.push(draft);
  }

  return {
    tasks,
    ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
  };
}

function stripJsonFence(value: string): string {
  // The model is told to emit raw JSON. Tolerate accidental ```json fences.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m;
  const match = value.match(fence);
  return match ? match[1]! : value;
}

function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}
