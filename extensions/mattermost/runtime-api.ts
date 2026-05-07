// Private runtime barrel for the bundled Mattermost extension.
// Keep this barrel thin and generic-only.

export type {
  BaseProbeResult,
  ChannelAccountSnapshot,
  ChannelDirectoryEntry,
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelPlugin,
  ChatType,
  HistoryEntry,
  AlienConfig,
  AlienPluginApi,
  PluginRuntime,
} from "alien/plugin-sdk/core";
export type { RuntimeEnv } from "alien/plugin-sdk/runtime";
export type { ReplyPayload } from "alien/plugin-sdk/reply-runtime";
export type { ModelsProviderData } from "alien/plugin-sdk/command-auth";
export type {
  BlockStreamingCoalesceConfig,
  DmPolicy,
  GroupPolicy,
} from "alien/plugin-sdk/config-types";
export {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  createDedupeCache,
  parseStrictPositiveInteger,
  resolveClientIp,
  isTrustedProxyAddress,
} from "alien/plugin-sdk/core";
export { buildComputedAccountStatusSnapshot } from "alien/plugin-sdk/channel-status";
export { createAccountStatusSink } from "alien/plugin-sdk/channel-lifecycle";
export { buildAgentMediaPayload } from "alien/plugin-sdk/agent-media-payload";
export {
  buildModelsProviderData,
  listSkillCommandsForAgents,
  resolveControlCommandGate,
  resolveStoredModelOverride,
} from "alien/plugin-sdk/command-auth";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "alien/plugin-sdk/runtime-group-policy";
export { isDangerousNameMatchingEnabled } from "alien/plugin-sdk/dangerous-name-runtime";
export { loadSessionStore, resolveStorePath } from "alien/plugin-sdk/session-store-runtime";
export { formatInboundFromLabel } from "alien/plugin-sdk/channel-inbound";
export { logInboundDrop } from "alien/plugin-sdk/channel-inbound";
export { createChannelPairingController } from "alien/plugin-sdk/channel-pairing";
export {
  DM_GROUP_ACCESS_REASON,
  readStoreAllowFromForDmPolicy,
  resolveDmGroupAccessWithLists,
  resolveEffectiveAllowFromLists,
} from "alien/plugin-sdk/channel-policy";
export { evaluateSenderGroupAccessForPolicy } from "alien/plugin-sdk/group-access";
export { createChannelMessageReplyPipeline } from "alien/plugin-sdk/channel-message";
export { logTypingFailure } from "alien/plugin-sdk/channel-feedback";
export { loadOutboundMediaFromUrl } from "alien/plugin-sdk/outbound-media";
export { rawDataToString } from "alien/plugin-sdk/webhook-ingress";
export { chunkTextForOutbound } from "alien/plugin-sdk/text-chunking";
export {
  DEFAULT_GROUP_HISTORY_LIMIT,
  buildPendingHistoryContextFromMap,
  clearHistoryEntriesIfEnabled,
  recordPendingHistoryEntryIfEnabled,
} from "alien/plugin-sdk/reply-history";
export { normalizeAccountId, resolveThreadSessionKeys } from "alien/plugin-sdk/routing";
export { resolveAllowlistMatchSimple } from "alien/plugin-sdk/allow-from";
export { registerPluginHttpRoute } from "alien/plugin-sdk/webhook-targets";
export {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
} from "alien/plugin-sdk/webhook-ingress";
export {
  applyAccountNameToChannelSection,
  applySetupAccountConfigPatch,
  migrateBaseNameToDefaultAccount,
} from "alien/plugin-sdk/setup";
export {
  getAgentScopedMediaLocalRoots,
  resolveChannelMediaMaxBytes,
} from "alien/plugin-sdk/media-runtime";
export { normalizeProviderId } from "alien/plugin-sdk/provider-model-shared";
export { setMattermostRuntime } from "./src/runtime.js";
