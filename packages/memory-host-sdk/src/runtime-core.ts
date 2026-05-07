// Focused runtime contract for memory plugin config/state/helpers.

export type { AnyAgentTool } from "./host/alien-runtime-agent.js";
export { resolveCronStyleNow } from "./host/alien-runtime-agent.js";
export { DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR } from "./host/alien-runtime-agent.js";
export { resolveDefaultAgentId, resolveSessionAgentId } from "./host/alien-runtime-agent.js";
export { resolveMemorySearchConfig } from "./host/alien-runtime-agent.js";
export {
  asToolParamsRecord,
  jsonResult,
  readNumberParam,
  readStringParam,
} from "./host/alien-runtime-agent.js";
export { SILENT_REPLY_TOKEN } from "./host/alien-runtime-session.js";
export { parseNonNegativeByteSize } from "./host/alien-runtime-config.js";
export {
  getRuntimeConfig,
  /** @deprecated Use getRuntimeConfig(), or pass the already loaded config through the call path. */
  loadConfig,
} from "./host/alien-runtime-config.js";
export { resolveStateDir } from "./host/alien-runtime-config.js";
export { resolveSessionTranscriptsDirForAgent } from "./host/alien-runtime-config.js";
export { emptyPluginConfigSchema } from "./host/alien-runtime-memory.js";
export {
  buildActiveMemoryPromptSection,
  getMemoryCapabilityRegistration,
  listActiveMemoryPublicArtifacts,
} from "./host/alien-runtime-memory.js";
export { parseAgentSessionKey } from "./host/alien-runtime-agent.js";
export type { AlienConfig } from "./host/alien-runtime-config.js";
export type { MemoryCitationsMode } from "./host/alien-runtime-config.js";
export type {
  MemoryFlushPlan,
  MemoryFlushPlanResolver,
  MemoryPluginCapability,
  MemoryPluginPublicArtifact,
  MemoryPluginPublicArtifactsProvider,
  MemoryPluginRuntime,
  MemoryPromptSectionBuilder,
} from "./host/alien-runtime-memory.js";
export type { AlienPluginApi } from "./host/alien-runtime-memory.js";
