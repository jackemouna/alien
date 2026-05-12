import { normalizeChatType } from "../channels/chat-type.js";
import type { AlienConfig } from "../config/types.alien.js";
import {
  deriveInboundMessageHookContext,
  toPluginMessageContext,
} from "../hooks/message-hook-mappers.js";
import {
  measureDiagnosticsTimelineSpan,
  measureDiagnosticsTimelineSpanSync,
} from "../infra/diagnostics-timeline.js";
import { emitChannelInbound } from "../plugin-sdk/channel-inbound-listener.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import type { SilentReplyConversationType } from "../shared/silent-reply-policy.js";
import { withReplyDispatcher } from "./dispatch-dispatcher.js";
import { dispatchReplyFromConfig } from "./reply/dispatch-from-config.js";
import type { DispatchFromConfigResult } from "./reply/dispatch-from-config.types.js";
import type { GetReplyFromConfig } from "./reply/get-reply.types.js";
import { finalizeInboundContext } from "./reply/inbound-context.js";
import {
  createReplyDispatcher,
  createReplyDispatcherWithTyping,
  type ReplyDispatchBeforeDeliver,
  type ReplyDispatcherOptions,
  type ReplyDispatcherWithTypingOptions,
} from "./reply/reply-dispatcher.js";
import type { ReplyDispatcher } from "./reply/reply-dispatcher.types.js";
import type { FinalizedMsgContext, MsgContext } from "./templating.js";
import type { GetReplyOptions, ReplyPayload } from "./types.js";

function resolveDispatcherSilentReplyContext(
  ctx: MsgContext | FinalizedMsgContext,
  cfg: AlienConfig,
) {
  const finalized = finalizeInboundContext(ctx);
  const policySessionKey =
    finalized.CommandSource === "native"
      ? (finalized.CommandTargetSessionKey ?? finalized.SessionKey)
      : finalized.SessionKey;
  const chatType = normalizeChatType(finalized.ChatType);
  const conversationType: SilentReplyConversationType | undefined =
    finalized.CommandSource === "native" &&
    finalized.CommandTargetSessionKey &&
    finalized.CommandTargetSessionKey !== finalized.SessionKey
      ? undefined
      : chatType === "direct"
        ? "direct"
        : chatType === "group" || chatType === "channel"
          ? "group"
          : undefined;
  return {
    cfg,
    sessionKey: policySessionKey,
    surface: finalized.Surface ?? finalized.Provider,
    conversationType,
  };
}

function resolveInboundReplyHookTarget(
  finalized: FinalizedMsgContext,
  hookCtx: ReturnType<typeof deriveInboundMessageHookContext>,
): string {
  if (typeof finalized.OriginatingTo === "string" && finalized.OriginatingTo.trim()) {
    return finalized.OriginatingTo;
  }
  if (hookCtx.isGroup) {
    return hookCtx.conversationId ?? hookCtx.to ?? hookCtx.from;
  }
  return hookCtx.from || hookCtx.conversationId || hookCtx.to || "";
}

function buildMessageSendingBeforeDeliver(
  ctx: MsgContext | FinalizedMsgContext,
): ReplyDispatchBeforeDeliver | undefined {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("message_sending")) {
    return undefined;
  }

  const finalized = finalizeInboundContext(ctx);
  const hookCtx = deriveInboundMessageHookContext(finalized);
  const replyTarget = resolveInboundReplyHookTarget(finalized, hookCtx);

  return async (payload: ReplyPayload): Promise<ReplyPayload | null> => {
    if (!payload.text) {
      return payload;
    }

    const result = await hookRunner.runMessageSending(
      { content: payload.text, to: replyTarget },
      toPluginMessageContext(hookCtx),
    );

    if (result?.cancel) {
      return null;
    }
    if (result?.content != null) {
      return { ...payload, text: result.content };
    }
    return payload;
  };
}

function buildDispatchTimelineAttributes(ctx: MsgContext | FinalizedMsgContext) {
  return {
    surface:
      typeof ctx.Surface === "string"
        ? ctx.Surface
        : typeof ctx.Provider === "string"
          ? ctx.Provider
          : "unknown",
    hasSessionKey:
      typeof ctx.SessionKey === "string" || typeof ctx.CommandTargetSessionKey === "string",
    commandSource: typeof ctx.CommandSource === "string" ? ctx.CommandSource : "message",
  };
}

export type DispatchInboundResult = DispatchFromConfigResult;
export { settleReplyDispatcher, withReplyDispatcher } from "./dispatch-dispatcher.js";

function finalizeDispatchResult(
  result: DispatchFromConfigResult,
  dispatcher: ReplyDispatcher,
): DispatchFromConfigResult {
  const cancelledCounts = dispatcher.getCancelledCounts?.();
  const failedCounts = dispatcher.getFailedCounts?.();
  if (!cancelledCounts && !failedCounts) {
    return result;
  }

  const resultCounts = {
    tool: result.counts?.tool ?? 0,
    block: result.counts?.block ?? 0,
    final: result.counts?.final ?? 0,
  };
  const counts = {
    tool: Math.max(0, resultCounts.tool - (cancelledCounts?.tool ?? 0) - (failedCounts?.tool ?? 0)),
    block: Math.max(
      0,
      resultCounts.block - (cancelledCounts?.block ?? 0) - (failedCounts?.block ?? 0),
    ),
    final: Math.max(
      0,
      resultCounts.final - (cancelledCounts?.final ?? 0) - (failedCounts?.final ?? 0),
    ),
  };
  const hasFailedCounts =
    (failedCounts?.tool ?? 0) > 0 ||
    (failedCounts?.block ?? 0) > 0 ||
    (failedCounts?.final ?? 0) > 0;
  return {
    ...result,
    queuedFinal: result.queuedFinal && counts.final > 0,
    counts,
    ...(hasFailedCounts ? { failedCounts } : {}),
  };
}

export async function dispatchInboundMessage(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: AlienConfig;
  dispatcher: ReplyDispatcher;
  replyOptions?: Omit<GetReplyOptions, "onBlockReply">;
  replyResolver?: GetReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const finalized = measureDiagnosticsTimelineSpanSync(
    "auto_reply.finalize_context",
    () => finalizeInboundContext(params.ctx),
    {
      phase: "agent-turn",
      config: params.cfg,
      attributes: buildDispatchTimelineAttributes(params.ctx),
    },
  );
  // Observer hook so the project-inbox router (and any future subscribers)
  // can react to inbound channel DMs without intercepting auto-reply.
  // Listeners are non-blocking; errors are swallowed by notifyListeners.
  void notifyChannelInboundFromCtx(finalized);
  const result = await withReplyDispatcher({
    dispatcher: params.dispatcher,
    run: () =>
      measureDiagnosticsTimelineSpan(
        "auto_reply.dispatch_reply_from_config",
        () =>
          dispatchReplyFromConfig({
            ctx: finalized,
            cfg: params.cfg,
            dispatcher: params.dispatcher,
            replyOptions: params.replyOptions,
            replyResolver: params.replyResolver,
          }),
        {
          phase: "agent-turn",
          config: params.cfg,
          attributes: buildDispatchTimelineAttributes(finalized),
        },
      ),
  });
  return finalizeDispatchResult(result, params.dispatcher);
}

export async function dispatchInboundMessageWithBufferedDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: AlienConfig;
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  replyOptions?: Omit<GetReplyOptions, "onBlockReply">;
  replyResolver?: GetReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const silentReplyContext = resolveDispatcherSilentReplyContext(params.ctx, params.cfg);
  const beforeDeliver =
    params.dispatcherOptions.beforeDeliver ?? buildMessageSendingBeforeDeliver(params.ctx);
  const { dispatcher, replyOptions, markDispatchIdle, markRunComplete } =
    createReplyDispatcherWithTyping({
      ...params.dispatcherOptions,
      beforeDeliver,
      silentReplyContext: params.dispatcherOptions.silentReplyContext ?? silentReplyContext,
    });
  try {
    return await dispatchInboundMessage({
      ctx: params.ctx,
      cfg: params.cfg,
      dispatcher,
      replyResolver: params.replyResolver,
      replyOptions: {
        ...params.replyOptions,
        ...replyOptions,
      },
    });
  } finally {
    markRunComplete();
    markDispatchIdle();
  }
}

export async function dispatchInboundMessageWithDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: AlienConfig;
  dispatcherOptions: ReplyDispatcherOptions;
  replyOptions?: Omit<GetReplyOptions, "onBlockReply">;
  replyResolver?: GetReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const silentReplyContext = resolveDispatcherSilentReplyContext(params.ctx, params.cfg);
  const dispatcher = createReplyDispatcher({
    ...params.dispatcherOptions,
    beforeDeliver:
      params.dispatcherOptions.beforeDeliver ?? buildMessageSendingBeforeDeliver(params.ctx),
    silentReplyContext: params.dispatcherOptions.silentReplyContext ?? silentReplyContext,
  });
  return await dispatchInboundMessage({
    ctx: params.ctx,
    cfg: params.cfg,
    dispatcher,
    replyResolver: params.replyResolver,
    replyOptions: params.replyOptions,
  });
}

/**
 * Project-inbox routing + custom hook subscribers observe inbound channel
 * messages without intercepting the auto-reply dispatch. We emit once per
 * dispatchInboundMessage call, after context finalization, with the
 * channel-relevant fields lifted out of `MsgContext`.
 */
function notifyChannelInboundFromCtx(ctx: FinalizedMsgContext): void {
  const channel = ctx.Provider;
  if (!channel || typeof channel !== "string") return;
  const text =
    typeof ctx.Body === "string"
      ? ctx.Body
      : typeof ctx.RawBody === "string"
        ? ctx.RawBody
        : typeof ctx.CommandBody === "string"
          ? ctx.CommandBody
          : "";
  if (!text) return;
  emitChannelInbound({
    channel,
    ...(typeof ctx.AccountId === "string" && ctx.AccountId ? { accountId: ctx.AccountId } : {}),
    ...(typeof ctx.From === "string" && ctx.From ? { from: ctx.From } : {}),
    ...(typeof ctx.To === "string" && ctx.To ? { to: ctx.To } : {}),
    ...(typeof ctx.RootMessageId === "string" && ctx.RootMessageId
      ? { threadId: ctx.RootMessageId }
      : typeof ctx.ReplyToId === "string" && ctx.ReplyToId
        ? { threadId: ctx.ReplyToId }
        : {}),
    ...(typeof ctx.MessageSid === "string" && ctx.MessageSid ? { messageId: ctx.MessageSid } : {}),
    text,
  });
}
