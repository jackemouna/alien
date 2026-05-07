// Private runtime barrel for the bundled Feishu extension.
// Keep this barrel thin and generic-only.

export type {
  AllowlistMatch,
  AnyAgentTool,
  BaseProbeResult,
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelMeta,
  ChannelOutboundAdapter,
  ChannelPlugin,
  HistoryEntry,
  AlienConfig,
  AlienPluginApi,
  OutboundIdentity,
  PluginRuntime,
  ReplyPayload,
} from "alien/plugin-sdk/core";
export type { AlienConfig as ClawdbotConfig } from "alien/plugin-sdk/core";
export type { RuntimeEnv } from "alien/plugin-sdk/runtime";
export type { GroupToolPolicyConfig } from "alien/plugin-sdk/config-types";
export {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  createActionGate,
  createDedupeCache,
} from "alien/plugin-sdk/core";
export {
  PAIRING_APPROVED_MESSAGE,
  buildProbeChannelStatusSummary,
  createDefaultChannelRuntimeState,
} from "alien/plugin-sdk/channel-status";
export { buildAgentMediaPayload } from "alien/plugin-sdk/agent-media-payload";
export { createChannelPairingController } from "alien/plugin-sdk/channel-pairing";
export { createReplyPrefixContext } from "alien/plugin-sdk/channel-message";
export {
  evaluateSupplementalContextVisibility,
  filterSupplementalContextItems,
  resolveChannelContextVisibilityMode,
} from "alien/plugin-sdk/context-visibility-runtime";
export {
  loadSessionStore,
  resolveSessionStoreEntry,
} from "alien/plugin-sdk/session-store-runtime";
export { readJsonFileWithFallback } from "alien/plugin-sdk/json-store";
export { createPersistentDedupe } from "alien/plugin-sdk/persistent-dedupe";
export { normalizeAgentId } from "alien/plugin-sdk/routing";
export { chunkTextForOutbound } from "alien/plugin-sdk/text-chunking";
export {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "alien/plugin-sdk/webhook-ingress";
export { setFeishuRuntime } from "./src/runtime.js";
