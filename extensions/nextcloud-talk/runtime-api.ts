// Private runtime barrel for the bundled Nextcloud Talk extension.
// Keep this barrel thin and aligned with the local extension surface.

export type { AllowlistMatch } from "alien/plugin-sdk/allow-from";
export type { ChannelGroupContext } from "alien/plugin-sdk/channel-contract";
export { logInboundDrop } from "alien/plugin-sdk/channel-logging";
export { createChannelPairingController } from "alien/plugin-sdk/channel-pairing";
export {
  readStoreAllowFromForDmPolicy,
  resolveDmGroupAccessWithCommandGate,
} from "alien/plugin-sdk/channel-policy";
export type {
  BlockStreamingCoalesceConfig,
  DmConfig,
  DmPolicy,
  GroupPolicy,
  GroupToolPolicyConfig,
  AlienConfig,
} from "alien/plugin-sdk/config-types";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "alien/plugin-sdk/runtime-group-policy";
export { dispatchChannelMessageReplyWithBase } from "alien/plugin-sdk/channel-message";
export type { OutboundReplyPayload } from "alien/plugin-sdk/reply-payload";
export { deliverFormattedTextWithAttachments } from "alien/plugin-sdk/reply-payload";
export type { PluginRuntime } from "alien/plugin-sdk/runtime-store";
export type { RuntimeEnv } from "alien/plugin-sdk/runtime";
export type { SecretInput } from "alien/plugin-sdk/secret-input";
export { fetchWithSsrFGuard } from "alien/plugin-sdk/ssrf-runtime";
export { setNextcloudTalkRuntime } from "./src/runtime.js";
