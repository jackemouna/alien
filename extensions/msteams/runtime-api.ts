// Private runtime barrel for the bundled Microsoft Teams extension.
// Keep this barrel thin and aligned with the local extension surface.

export { DEFAULT_ACCOUNT_ID } from "alien/plugin-sdk/account-id";
export type { AllowlistMatch } from "alien/plugin-sdk/allow-from";
export {
  mergeAllowlist,
  resolveAllowlistMatchSimple,
  summarizeMapping,
} from "alien/plugin-sdk/allow-from";
export type {
  BaseProbeResult,
  ChannelDirectoryEntry,
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelOutboundAdapter,
} from "alien/plugin-sdk/channel-contract";
export type { ChannelPlugin } from "alien/plugin-sdk/channel-core";
export { logTypingFailure } from "alien/plugin-sdk/channel-logging";
export { createChannelPairingController } from "alien/plugin-sdk/channel-pairing";
export {
  evaluateSenderGroupAccessForPolicy,
  readStoreAllowFromForDmPolicy,
  resolveDmGroupAccessWithLists,
  resolveEffectiveAllowFromLists,
  resolveSenderScopedGroupPolicy,
  resolveToolsBySender,
} from "alien/plugin-sdk/channel-policy";
export { createChannelMessageReplyPipeline } from "alien/plugin-sdk/channel-message";
export {
  PAIRING_APPROVED_MESSAGE,
  buildProbeChannelStatusSummary,
  createDefaultChannelRuntimeState,
} from "alien/plugin-sdk/channel-status";
export {
  buildChannelKeyCandidates,
  normalizeChannelSlug,
  resolveChannelEntryMatchWithFallback,
  resolveNestedAllowlistDecision,
} from "alien/plugin-sdk/channel-targets";
export type {
  GroupPolicy,
  GroupToolPolicyConfig,
  MSTeamsChannelConfig,
  MSTeamsConfig,
  MSTeamsReplyStyle,
  MSTeamsTeamConfig,
  MarkdownTableMode,
  AlienConfig,
} from "alien/plugin-sdk/config-types";
export { isDangerousNameMatchingEnabled } from "alien/plugin-sdk/dangerous-name-runtime";
export { resolveDefaultGroupPolicy } from "alien/plugin-sdk/runtime-group-policy";
export { withFileLock } from "alien/plugin-sdk/file-lock";
export { keepHttpServerTaskAlive } from "alien/plugin-sdk/channel-lifecycle";
export {
  detectMime,
  extensionForMime,
  extractOriginalFilename,
  getFileExtension,
  resolveChannelMediaMaxBytes,
} from "alien/plugin-sdk/media-runtime";
export { dispatchReplyFromConfigWithSettledDispatcher } from "alien/plugin-sdk/inbound-reply-dispatch";
export { loadOutboundMediaFromUrl } from "alien/plugin-sdk/outbound-media";
export { buildMediaPayload } from "alien/plugin-sdk/reply-payload";
export type { ReplyPayload } from "alien/plugin-sdk/reply-payload";
export type { PluginRuntime } from "alien/plugin-sdk/runtime-store";
export type { RuntimeEnv } from "alien/plugin-sdk/runtime";
export type { SsrFPolicy } from "alien/plugin-sdk/ssrf-runtime";
export { fetchWithSsrFGuard } from "alien/plugin-sdk/ssrf-runtime";
export { normalizeStringEntries } from "alien/plugin-sdk/string-normalization-runtime";
export { chunkTextForOutbound } from "alien/plugin-sdk/text-chunking";
export { DEFAULT_WEBHOOK_MAX_BODY_BYTES } from "alien/plugin-sdk/webhook-ingress";
export { setMSTeamsRuntime } from "./src/runtime.js";
