// Real workspace contract for memory engine foundation concerns.

export {
  resolveAgentContextLimits,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  resolveSessionAgentId,
} from "./host/alien-runtime-agent.js";
export {
  resolveMemorySearchConfig,
  resolveMemorySearchSyncConfig,
  type ResolvedMemorySearchConfig,
  type ResolvedMemorySearchSyncConfig,
} from "./host/alien-runtime-agent.js";
export { parseDurationMs } from "./host/alien-runtime-config.js";
export { loadConfig } from "./host/alien-runtime-config.js";
export { resolveStateDir } from "./host/alien-runtime-config.js";
export { resolveSessionTranscriptsDirForAgent } from "./host/alien-runtime-config.js";
export {
  hasConfiguredSecretInput,
  normalizeResolvedSecretInputString,
} from "./host/alien-runtime-config.js";
export { root } from "./host/alien-runtime-io.js";
export { isPathInside } from "./host/fs-utils.js";
export { createSubsystemLogger } from "./host/alien-runtime-io.js";
export { detectMime } from "./host/alien-runtime-io.js";
export { resolveGlobalSingleton } from "./host/alien-runtime-io.js";
export { onSessionTranscriptUpdate } from "./host/alien-runtime-session.js";
export { splitShellArgs } from "./host/alien-runtime-io.js";
export { runTasksWithConcurrency } from "./host/alien-runtime-io.js";
export {
  shortenHomeInString,
  shortenHomePath,
  resolveUserPath,
  truncateUtf16Safe,
} from "./host/alien-runtime-io.js";
export type { AlienConfig } from "./host/alien-runtime-config.js";
export type { SessionSendPolicyConfig } from "./host/alien-runtime-config.js";
export type { SecretInput } from "./host/alien-runtime-config.js";
export type {
  MemoryBackend,
  MemoryCitationsMode,
  MemoryQmdConfig,
  MemoryQmdIndexPath,
  MemoryQmdMcporterConfig,
  MemoryQmdSearchMode,
} from "./host/alien-runtime-config.js";
export type { MemorySearchConfig } from "./host/alien-runtime-config.js";
