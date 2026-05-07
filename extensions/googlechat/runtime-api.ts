// Private runtime barrel for the bundled Google Chat extension.
// Keep this barrel thin and avoid broad plugin-sdk surfaces during bootstrap.

export { DEFAULT_ACCOUNT_ID } from "alien/plugin-sdk/account-id";
export {
  createActionGate,
  jsonResult,
  readNumberParam,
  readReactionParams,
  readStringParam,
} from "alien/plugin-sdk/channel-actions";
export { buildChannelConfigSchema } from "alien/plugin-sdk/channel-config-primitives";
export type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
  ChannelStatusIssue,
} from "alien/plugin-sdk/channel-contract";
export { missingTargetError } from "alien/plugin-sdk/channel-feedback";
export {
  createAccountStatusSink,
  runPassiveAccountLifecycle,
} from "alien/plugin-sdk/channel-lifecycle";
export { createChannelPairingController } from "alien/plugin-sdk/channel-pairing";
export { createChannelMessageReplyPipeline } from "alien/plugin-sdk/channel-message";
export {
  evaluateGroupRouteAccessForPolicy,
  resolveDmGroupAccessWithLists,
  resolveSenderScopedGroupPolicy,
} from "alien/plugin-sdk/channel-policy";
export { PAIRING_APPROVED_MESSAGE } from "alien/plugin-sdk/channel-status";
export { chunkTextForOutbound } from "alien/plugin-sdk/text-chunking";
export type { AlienConfig } from "alien/plugin-sdk/config-types";
export { GoogleChatConfigSchema } from "alien/plugin-sdk/bundled-channel-config-schema";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "alien/plugin-sdk/runtime-group-policy";
export { isDangerousNameMatchingEnabled } from "alien/plugin-sdk/dangerous-name-runtime";
export { fetchRemoteMedia, resolveChannelMediaMaxBytes } from "alien/plugin-sdk/media-runtime";
export { loadOutboundMediaFromUrl } from "alien/plugin-sdk/outbound-media";
export type { PluginRuntime } from "alien/plugin-sdk/runtime-store";
export { fetchWithSsrFGuard } from "alien/plugin-sdk/ssrf-runtime";
export type { GoogleChatAccountConfig, GoogleChatConfig } from "alien/plugin-sdk/config-types";
export { extractToolSend } from "alien/plugin-sdk/tool-send";
export { resolveInboundMentionDecision } from "alien/plugin-sdk/channel-inbound";
export { resolveInboundRouteEnvelopeBuilderWithRuntime } from "alien/plugin-sdk/inbound-envelope";
export { resolveWebhookPath } from "alien/plugin-sdk/webhook-path";
export {
  registerWebhookTargetWithPluginRoute,
  resolveWebhookTargetWithAuthOrReject,
  withResolvedWebhookRequestPipeline,
} from "alien/plugin-sdk/webhook-targets";
export {
  createWebhookInFlightLimiter,
  readJsonWebhookBodyOrReject,
  type WebhookInFlightLimiter,
} from "alien/plugin-sdk/webhook-request-guards";
export { setGoogleChatRuntime } from "./src/runtime.js";
