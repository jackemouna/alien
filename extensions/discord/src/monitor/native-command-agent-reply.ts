import { resolveHumanDelayConfig } from "alien/plugin-sdk/agent-runtime";
import { createChannelMessageReplyPipeline } from "alien/plugin-sdk/channel-message";
import { resolveChannelStreamingBlockEnabled } from "alien/plugin-sdk/channel-streaming";
import type { AlienConfig } from "alien/plugin-sdk/config-types";
import { getAgentScopedMediaLocalRoots } from "alien/plugin-sdk/media-runtime";
import { resolveChunkMode, resolveTextChunkLimit } from "alien/plugin-sdk/reply-chunking";
import type { createSubsystemLogger } from "alien/plugin-sdk/runtime-env";
import { logVerbose } from "alien/plugin-sdk/runtime-env";
import { resolveDiscordMaxLinesPerMessage } from "../accounts.js";
import type {
  ButtonInteraction,
  CommandInteraction,
  StringSelectMenuInteraction,
} from "../internal/discord.js";
import type { DiscordChannelConfigResolved } from "./allow-list.js";
import type { buildDiscordNativeCommandContext } from "./native-command-context.js";
import {
  DISCORD_EMPTY_VISIBLE_REPLY_WARNING,
  deliverDiscordInteractionReply,
  isDiscordUnknownInteraction,
  safeDiscordInteractionCall,
} from "./native-command-reply.js";
import { nativeCommandRuntime } from "./native-command.runtime.js";
import type { DiscordConfig } from "./native-command.types.js";

type NativeCommandEffectiveRoute = {
  accountId: string;
  agentId: string;
};

export async function dispatchDiscordNativeAgentReply(params: {
  cfg: AlienConfig;
  discordConfig: DiscordConfig;
  accountId: string;
  interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction;
  ctxPayload: ReturnType<typeof buildDiscordNativeCommandContext>;
  effectiveRoute: NativeCommandEffectiveRoute;
  channelConfig: DiscordChannelConfigResolved | null;
  mediaLocalRoots: ReturnType<typeof getAgentScopedMediaLocalRoots>;
  preferFollowUp: boolean;
  responseEphemeral?: boolean;
  suppressReplies?: boolean;
  log: ReturnType<typeof createSubsystemLogger>;
}): Promise<void> {
  const { onModelSelected, ...replyPipeline } = createChannelMessageReplyPipeline({
    cfg: params.cfg,
    agentId: params.effectiveRoute.agentId,
    channel: "discord",
    accountId: params.effectiveRoute.accountId,
  });
  const blockStreamingEnabled = resolveChannelStreamingBlockEnabled(params.discordConfig);

  let didReply = false;
  const dispatchResult = await nativeCommandRuntime.dispatchReplyWithDispatcher({
    ctx: params.ctxPayload,
    cfg: params.cfg,
    dispatcherOptions: {
      ...replyPipeline,
      humanDelay: resolveHumanDelayConfig(params.cfg, params.effectiveRoute.agentId),
      deliver: async (payload) => {
        if (params.suppressReplies) {
          return;
        }
        try {
          await deliverDiscordInteractionReply({
            interaction: params.interaction,
            payload,
            mediaLocalRoots: params.mediaLocalRoots,
            textLimit: resolveTextChunkLimit(params.cfg, "discord", params.accountId, {
              fallbackLimit: 2000,
            }),
            maxLinesPerMessage: resolveDiscordMaxLinesPerMessage({
              cfg: params.cfg,
              discordConfig: params.discordConfig,
              accountId: params.accountId,
            }),
            preferFollowUp: params.preferFollowUp || didReply,
            responseEphemeral: params.responseEphemeral,
            chunkMode: resolveChunkMode(params.cfg, "discord", params.accountId),
          });
        } catch (error) {
          if (isDiscordUnknownInteraction(error)) {
            logVerbose("discord: interaction reply skipped (interaction expired)");
            return;
          }
          throw error;
        }
        didReply = true;
      },
      onError: (err, info) => {
        const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
        params.log.error(`discord slash ${info.kind} reply failed: ${message}`);
      },
    },
    replyOptions: {
      skillFilter: params.channelConfig?.skills,
      disableBlockStreaming:
        typeof blockStreamingEnabled === "boolean" ? !blockStreamingEnabled : undefined,
      onModelSelected,
    },
  });

  if (
    params.suppressReplies ||
    didReply ||
    dispatchResult.queuedFinal ||
    dispatchResult.counts.final !== 0 ||
    dispatchResult.counts.block !== 0 ||
    dispatchResult.counts.tool !== 0
  ) {
    return;
  }

  await safeDiscordInteractionCall("interaction empty fallback", async () => {
    const payload = {
      content: DISCORD_EMPTY_VISIBLE_REPLY_WARNING,
      ephemeral: true,
    };
    if (params.preferFollowUp) {
      await params.interaction.followUp(payload);
      return;
    }
    await params.interaction.reply(payload);
  });
}
