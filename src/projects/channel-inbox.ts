import type { LlmClient } from "../orchestrator/llm-client.js";
import {
  emitChannelInbound,
  onChannelInbound,
  type ChannelInboundEvent,
} from "../plugin-sdk/channel-inbound-listener.js";
import { plan, persistPlan } from "./planner.js";
import { listProjectIds, listTasks, loadProject, type ProjectStoreOptions } from "./store.js";
import type { Project, TaskOrigin } from "./types.js";

/**
 * Routes inbound channel messages (Slack/Discord/Telegram/...) to bound
 * Projects. Workflow:
 *
 *   1. Channel plugin's dispatch calls core's `dispatchInboundMessage` which
 *      emits `channel-inbound` (see src/auto-reply/dispatch.ts).
 *   2. `bindChannelInboxToProjects()` subscribes once at gateway boot.
 *   3. On each event, the router scans active projects for a binding that
 *      matches `{ channel, accountId? }`.
 *   4. If a project matches, the planner emits Tasks tagged with
 *      `origin: { kind: "channel", channel, accountId, threadId, … }`.
 *   5. The pickup loop (also in this module's siblings) claims the tasks.
 *   6. Workers complete; outbound replies use the task's origin metadata to
 *      post back to the same thread (see src/projects/channel-reply.ts).
 *
 * The router observes inbound — it does NOT intercept auto-reply. If a
 * channel is bound to a project AND auto-reply is enabled for the same
 * conversation, both fire. Operators disable the chat-side auto-reply for
 * project-only Slack channels via existing channel config.
 */

export type RouteInboundMessageOptions = {
  readonly projectsDir: string;
  readonly llm: LlmClient;
  readonly auditLogPath?: string;
  readonly storeOptions?: ProjectStoreOptions;
  readonly now?: () => string;
};

export type RouteInboundMessageResult =
  | { readonly ok: true; readonly projectId: string; readonly taskCount: number }
  | {
      readonly ok: false;
      readonly reason: "no-binding" | "empty-prompt" | "planner-error";
      readonly error?: string;
    };

export async function routeInboundMessage(
  evt: ChannelInboundEvent,
  opts: RouteInboundMessageOptions,
): Promise<RouteInboundMessageResult> {
  const prompt = evt.text.trim();
  if (!prompt) {
    return { ok: false, reason: "empty-prompt" };
  }
  const project = findProjectForChannel(evt, opts);
  if (!project) {
    return { ok: false, reason: "no-binding" };
  }
  const origin: TaskOrigin = {
    kind: "channel",
    channel: evt.channel,
    ...(evt.accountId ? { accountId: evt.accountId } : {}),
    ...(evt.threadId ? { threadId: evt.threadId } : {}),
    ...(evt.fromDisplayName ? { authorDisplayName: evt.fromDisplayName } : {}),
  };
  const existing = listTasks(opts.projectsDir, project.id, opts.storeOptions);
  try {
    const result = await plan(
      { projectId: project.id, prompt, origin, existing },
      { llm: opts.llm },
    );
    const created = persistPlan(project.id, result, {
      projectsDir: opts.projectsDir,
      origin,
      ...(opts.auditLogPath ? { auditLogPath: opts.auditLogPath } : {}),
      ...(opts.storeOptions ? { storeOptions: opts.storeOptions } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
    return { ok: true, projectId: project.id, taskCount: created.length };
  } catch (err) {
    return { ok: false, reason: "planner-error", error: stringifyError(err) };
  }
}

function findProjectForChannel(
  evt: ChannelInboundEvent,
  opts: RouteInboundMessageOptions,
): Project | null {
  const ids = listProjectIds(opts.projectsDir, opts.storeOptions);
  for (const projectId of ids) {
    const project = loadProject(opts.projectsDir, projectId, opts.storeOptions);
    if (!project || project.status !== "active") continue;
    const matched = project.channels.some(
      (binding) =>
        binding.channel === evt.channel &&
        (!binding.accountId || !evt.accountId || binding.accountId === evt.accountId),
    );
    if (matched) return project;
  }
  return null;
}

/**
 * Subscribes the project router to the channel-inbound event stream. Call
 * once at gateway boot. Returns the unsubscribe function (useful for tests
 * and graceful shutdown).
 *
 * Errors from individual events are swallowed and reported via the optional
 * `onRouteError` callback; the listener never blocks the auto-reply path.
 */
export function bindChannelInboxToProjects(opts: {
  readonly projectsDir: string;
  readonly llm: LlmClient;
  readonly auditLogPath?: string;
  readonly onRouteError?: (err: unknown, evt: ChannelInboundEvent) => void;
  readonly now?: () => string;
}): () => void {
  return onChannelInbound((evt) => {
    void routeInboundMessage(evt, {
      projectsDir: opts.projectsDir,
      llm: opts.llm,
      ...(opts.auditLogPath ? { auditLogPath: opts.auditLogPath } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    }).catch((err) => opts.onRouteError?.(err, evt));
  });
}

// Re-exported so tests and CLI tools can synthesize inbound events without
// reaching into the plugin-sdk surface directly.
export { emitChannelInbound };

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
