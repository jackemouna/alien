// Private runtime barrel for the bundled Voice Call extension.
// Keep this barrel thin and aligned with the local extension surface.

export { definePluginEntry } from "alien/plugin-sdk/plugin-entry";
export type { AlienPluginApi } from "alien/plugin-sdk/plugin-entry";
export type { GatewayRequestHandlerOptions } from "alien/plugin-sdk/gateway-runtime";
export {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "alien/plugin-sdk/webhook-request-guards";
export { fetchWithSsrFGuard, isBlockedHostnameOrIp } from "alien/plugin-sdk/ssrf-runtime";
export type { SessionEntry } from "alien/plugin-sdk/session-store-runtime";
export {
  TtsAutoSchema,
  TtsConfigSchema,
  TtsModeSchema,
  TtsProviderSchema,
} from "alien/plugin-sdk/tts-runtime";
export { sleep } from "alien/plugin-sdk/runtime-env";
