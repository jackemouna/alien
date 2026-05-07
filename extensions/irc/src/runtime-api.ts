// Private runtime barrel for the bundled IRC extension.
// Keep this barrel thin and generic-only.

export type { BaseProbeResult } from "alien/plugin-sdk/channel-contract";
export type { ChannelPlugin } from "alien/plugin-sdk/channel-core";
export type { AlienConfig } from "alien/plugin-sdk/config-types";
export type { PluginRuntime } from "alien/plugin-sdk/runtime-store";
export type { RuntimeEnv } from "alien/plugin-sdk/runtime";
export type {
  BlockStreamingCoalesceConfig,
  DmConfig,
  DmPolicy,
  GroupPolicy,
  GroupToolPolicyBySenderConfig,
  GroupToolPolicyConfig,
  MarkdownConfig,
} from "alien/plugin-sdk/config-types";
export type { OutboundReplyPayload } from "alien/plugin-sdk/reply-payload";
export { DEFAULT_ACCOUNT_ID } from "alien/plugin-sdk/account-id";
export { buildChannelConfigSchema } from "alien/plugin-sdk/channel-config-primitives";
export {
  PAIRING_APPROVED_MESSAGE,
  buildBaseChannelStatusSummary,
} from "alien/plugin-sdk/channel-status";
export { createChannelPairingController } from "alien/plugin-sdk/channel-pairing";
export { createAccountStatusSink } from "alien/plugin-sdk/channel-lifecycle";
export {
  readStoreAllowFromForDmPolicy,
  resolveEffectiveAllowFromLists,
} from "alien/plugin-sdk/channel-policy";
export { resolveControlCommandGate } from "alien/plugin-sdk/command-auth";
export { dispatchChannelMessageReplyWithBase } from "alien/plugin-sdk/channel-message";
export { chunkTextForOutbound } from "alien/plugin-sdk/text-chunking";
export {
  deliverFormattedTextWithAttachments,
  formatTextWithAttachmentLinks,
  resolveOutboundMediaUrls,
} from "alien/plugin-sdk/reply-payload";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "alien/plugin-sdk/runtime-group-policy";
export { isDangerousNameMatchingEnabled } from "alien/plugin-sdk/dangerous-name-runtime";
export { logInboundDrop } from "alien/plugin-sdk/channel-inbound";
