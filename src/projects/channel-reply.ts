import type { TaskRecord } from "./types.js";

/**
 * Posts a reply back to the channel that originated a task. Used by the
 * pickup loop when a task with `origin.kind === "channel"` completes (or
 * fails / enters review) so the user sees the result in the same Slack
 * thread / Discord channel / Telegram chat they DMed from.
 *
 * The actual send path is `sendDurableMessageBatch` from
 * `alien/plugin-sdk/channel-message`, but that helper requires a loaded
 * `AlienConfig` which `src/projects/` deliberately does not know about.
 * The gateway boot wraps the SDK call in a small adapter and threads it in
 * as the `send` option (see src/gateway/projects-runtime.ts when wired).
 * Tests inject a stub.
 */

export type ChannelReplyParams = {
  readonly channel: string;
  readonly to: string;
  readonly accountId?: string;
  readonly threadId?: string;
  readonly text: string;
};

export type ChannelReplySend = (params: ChannelReplyParams) => Promise<void>;

export type ChannelReplyOptions = {
  readonly send: ChannelReplySend;
};

export type ChannelReplyResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "not-channel-task" | "missing-target" | "send-failed";
      readonly error?: string;
    };

/**
 * Decides whether a task should produce a channel reply and, if so, sends
 * it. Tasks with a non-channel origin are skipped silently. A channel task
 * without a conversation target is also skipped — the planner is expected
 * to carry `to` through the origin, but operator-created tasks may not.
 */
export async function maybeReplyToChannelOrigin(
  task: TaskRecord,
  outcome: {
    readonly status: "done" | "review" | "failed";
    readonly result?: unknown;
    readonly error?: string;
  },
  options: ChannelReplyOptions,
): Promise<ChannelReplyResult> {
  if (task.origin.kind !== "channel") {
    return { ok: false, reason: "not-channel-task" };
  }
  // The planner can carry an explicit `channelReplyTo` in the task input
  // when the workflow needs to address a different conversation than the
  // inbound thread. Fall back to threadId for the simple "reply where it
  // came from" case.
  const inputTo = readStringInput(task.input, "channelReplyTo");
  const to = inputTo ?? task.origin.threadId ?? "";
  if (!to) {
    return { ok: false, reason: "missing-target" };
  }
  const params: ChannelReplyParams = {
    channel: task.origin.channel,
    to,
    ...(task.origin.accountId ? { accountId: task.origin.accountId } : {}),
    ...(task.origin.threadId ? { threadId: task.origin.threadId } : {}),
    text: formatReplyBody(task, outcome),
  };
  try {
    await options.send(params);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "send-failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function formatReplyBody(
  task: TaskRecord,
  outcome: {
    readonly status: "done" | "review" | "failed";
    readonly result?: unknown;
    readonly error?: string;
  },
): string {
  if (outcome.status === "failed") {
    return `Task "${task.title}" failed: ${outcome.error ?? "unknown error"}`;
  }
  if (outcome.status === "review") {
    return `Task "${task.title}" is awaiting review.\n\n${stringifyResult(outcome.result)}`;
  }
  return stringifyResult(outcome.result) || `Task "${task.title}" completed.`;
}

function stringifyResult(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function readStringInput(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
