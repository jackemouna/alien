// Narrow Matrix monitor helper seam.
// Keep monitor internals off the broad package runtime-api barrel so monitor
// tests and shared workers do not pull unrelated Matrix helper surfaces.

export type { NormalizedLocation } from "alien/plugin-sdk/channel-location";
export type { PluginRuntime, RuntimeLogger } from "alien/plugin-sdk/plugin-runtime";
export type { BlockReplyContext, ReplyPayload } from "alien/plugin-sdk/reply-runtime";
export type { MarkdownTableMode, AlienConfig } from "alien/plugin-sdk/config-types";
export type { RuntimeEnv } from "alien/plugin-sdk/runtime";
export {
  addAllowlistUserEntriesFromConfigEntry,
  buildAllowlistResolutionSummary,
  canonicalizeAllowlistWithResolvedIds,
  formatAllowlistMatchMeta,
  patchAllowlistUsersInConfigEntries,
  summarizeMapping,
} from "alien/plugin-sdk/allow-from";
export {
  createReplyPrefixOptions,
  createTypingCallbacks,
} from "alien/plugin-sdk/channel-reply-options-runtime";
export { formatLocationText, toLocationContext } from "alien/plugin-sdk/channel-location";
export { getAgentScopedMediaLocalRoots } from "alien/plugin-sdk/agent-media-payload";
export { logInboundDrop, logTypingFailure } from "alien/plugin-sdk/channel-logging";
export {
  buildChannelKeyCandidates,
  resolveChannelEntryMatch,
} from "alien/plugin-sdk/channel-targets";
