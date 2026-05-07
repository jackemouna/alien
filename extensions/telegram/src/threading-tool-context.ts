import type {
  ChannelThreadingContext,
  ChannelThreadingToolContext,
} from "alien/plugin-sdk/channel-contract";
import type { AlienConfig } from "alien/plugin-sdk/config-types";
import { normalizeOptionalString } from "alien/plugin-sdk/text-runtime";
import { parseTelegramTarget } from "./targets.js";

function resolveTelegramToolContextThreadId(context: ChannelThreadingContext): string | undefined {
  if (context.MessageThreadId != null) {
    return String(context.MessageThreadId);
  }
  const currentChannelId = normalizeOptionalString(context.To);
  if (!currentChannelId) {
    return undefined;
  }
  const parsedTarget = parseTelegramTarget(currentChannelId);
  return parsedTarget.messageThreadId != null ? String(parsedTarget.messageThreadId) : undefined;
}

export function buildTelegramThreadingToolContext(params: {
  cfg: AlienConfig;
  accountId?: string | null;
  context: ChannelThreadingContext;
  hasRepliedRef?: { value: boolean };
}): ChannelThreadingToolContext {
  void params.cfg;
  void params.accountId;

  return {
    currentChannelId: normalizeOptionalString(params.context.To),
    currentThreadTs: resolveTelegramToolContextThreadId(params.context),
    hasRepliedRef: params.hasRepliedRef,
  };
}
