import { TOOL_NAME_SEPARATOR } from "../../pi-bundle-mcp-names.js";
import type { AlienCodingToolConstructionPlan } from "../../pi-tools.js";
import { isToolAllowedByPolicyName } from "../../tool-policy-match.js";
import {
  buildPluginToolGroups,
  expandPolicyWithPluginGroups,
  expandToolGroups,
  normalizeToolName,
} from "../../tool-policy.js";

const BASE_CODING_TOOL_FACTORY_NAMES = new Set(["edit", "read", "write"]);

const SHELL_CODING_TOOL_FACTORY_NAMES = new Set(["apply_patch", "exec", "process"]);

// Names here must be emitted directly by createAlienTools(). Catalog entries
// backed by plugin registration, such as browser/x_search/code_execution, stay
// out of this set so narrow allowlists still materialize plugin tools.
const ALIEN_TOOL_FACTORY_NAMES = new Set([
  "agents_list",
  "canvas",
  "cron",
  "gateway",
  "heartbeat_respond",
  "heartbeat_response",
  "image",
  "image_generate",
  "message",
  "music_generate",
  "nodes",
  "pdf",
  "session_status",
  "sessions_history",
  "sessions_list",
  "sessions_send",
  "sessions_spawn",
  "sessions_yield",
  "subagents",
  "tts",
  "update_plan",
  "video_generate",
  "web_fetch",
  "web_search",
]);

const ALL_CODING_TOOL_CONSTRUCTION_PLAN: AlienCodingToolConstructionPlan = {
  includeBaseCodingTools: true,
  includeShellTools: true,
  includeChannelTools: true,
  includeAlienTools: true,
  includePluginTools: true,
};

const NO_CODING_TOOL_CONSTRUCTION_PLAN: AlienCodingToolConstructionPlan = {
  includeBaseCodingTools: false,
  includeShellTools: false,
  includeChannelTools: false,
  includeAlienTools: false,
  includePluginTools: false,
};

function cloneCodingToolConstructionPlan(
  plan: AlienCodingToolConstructionPlan,
): AlienCodingToolConstructionPlan {
  return { ...plan };
}

function isBundleMcpAllowlistName(normalized: string): boolean {
  return normalized === "bundle-mcp" || normalized.includes(TOOL_NAME_SEPARATOR);
}

function isPluginGroupAllowlistName(normalized: string): boolean {
  return normalized === "group:plugins";
}

function hasWildcardToolAllowlist(toolsAllow: string[]): boolean {
  return toolsAllow.some((entry) => normalizeToolName(entry) === "*");
}

function isKnownLocalCodingToolName(normalized: string): boolean {
  return (
    BASE_CODING_TOOL_FACTORY_NAMES.has(normalized) ||
    SHELL_CODING_TOOL_FACTORY_NAMES.has(normalized) ||
    ALIEN_TOOL_FACTORY_NAMES.has(normalized)
  );
}

export function applyEmbeddedAttemptToolsAllow<T extends { name: string }>(
  tools: T[],
  toolsAllow?: string[],
  options?: {
    toolMeta?: (tool: T) => { pluginId: string } | undefined;
  },
): T[] {
  if (!toolsAllow) {
    return tools;
  }
  if (toolsAllow.length === 0) {
    return [];
  }
  if (hasWildcardToolAllowlist(toolsAllow)) {
    return tools;
  }
  const pluginGroups = options?.toolMeta
    ? buildPluginToolGroups({ tools, toolMeta: options.toolMeta })
    : undefined;
  const policy = pluginGroups
    ? expandPolicyWithPluginGroups({ allow: toolsAllow }, pluginGroups)
    : { allow: toolsAllow };
  return tools.filter((tool) => isToolAllowedByPolicyName(tool.name, policy));
}

function resolveCodingToolConstructionPlanForAllowlist(
  toolsAllow?: string[],
): AlienCodingToolConstructionPlan {
  if (!toolsAllow) {
    return cloneCodingToolConstructionPlan(ALL_CODING_TOOL_CONSTRUCTION_PLAN);
  }
  if (toolsAllow.length === 0) {
    return cloneCodingToolConstructionPlan(NO_CODING_TOOL_CONSTRUCTION_PLAN);
  }
  if (hasWildcardToolAllowlist(toolsAllow)) {
    return cloneCodingToolConstructionPlan(ALL_CODING_TOOL_CONSTRUCTION_PLAN);
  }
  const expanded = expandToolGroups(toolsAllow);
  const normalized = expanded.map((entry) => normalizeToolName(entry)).filter(Boolean);
  const includeBaseCodingTools = normalized.some((name) =>
    BASE_CODING_TOOL_FACTORY_NAMES.has(name),
  );
  const includeShellTools = normalized.some((name) => SHELL_CODING_TOOL_FACTORY_NAMES.has(name));
  const includeAlienTools = normalized.some((name) => ALIEN_TOOL_FACTORY_NAMES.has(name));
  const includePluginTools = normalized.some(
    (name) =>
      name === "group:plugins" ||
      (!isBundleMcpAllowlistName(name) && !isKnownLocalCodingToolName(name)),
  );
  const includeChannelTools = includePluginTools;

  return {
    includeBaseCodingTools,
    includeShellTools,
    includeChannelTools,
    includeAlienTools,
    includePluginTools,
  };
}

export function resolveEmbeddedAttemptToolConstructionPlan(params: {
  disableTools?: boolean;
  isRawModelRun?: boolean;
  toolsAllow?: string[];
}): {
  constructTools: boolean;
  includeCoreTools: boolean;
  runtimeToolAllowlist?: string[];
  codingToolConstructionPlan: AlienCodingToolConstructionPlan;
} {
  if (params.disableTools === true || params.isRawModelRun === true) {
    return {
      constructTools: false,
      includeCoreTools: false,
      codingToolConstructionPlan: cloneCodingToolConstructionPlan(NO_CODING_TOOL_CONSTRUCTION_PLAN),
    };
  }
  const codingToolConstructionPlan = resolveCodingToolConstructionPlanForAllowlist(
    params.toolsAllow,
  );
  const includeCoreTools =
    codingToolConstructionPlan.includeBaseCodingTools ||
    codingToolConstructionPlan.includeShellTools ||
    codingToolConstructionPlan.includeAlienTools;
  const constructTools =
    includeCoreTools ||
    codingToolConstructionPlan.includeChannelTools ||
    codingToolConstructionPlan.includePluginTools;

  return {
    constructTools,
    includeCoreTools,
    ...(params.toolsAllow ? { runtimeToolAllowlist: params.toolsAllow } : {}),
    codingToolConstructionPlan,
  };
}

export function shouldBuildCoreCodingToolsForAllowlist(toolsAllow?: string[]): boolean {
  return resolveEmbeddedAttemptToolConstructionPlan({ toolsAllow }).includeCoreTools;
}

export function shouldCreateBundleMcpRuntimeForAttempt(params: {
  toolsEnabled: boolean;
  disableTools?: boolean;
  toolsAllow?: string[];
}): boolean {
  if (!params.toolsEnabled || params.disableTools === true) {
    return false;
  }
  if (!params.toolsAllow) {
    return true;
  }
  if (params.toolsAllow.length === 0) {
    return false;
  }
  if (hasWildcardToolAllowlist(params.toolsAllow)) {
    return true;
  }
  return params.toolsAllow.some((toolName) => {
    const normalized = normalizeToolName(toolName);
    return isBundleMcpAllowlistName(normalized) || isPluginGroupAllowlistName(normalized);
  });
}

export function shouldCreateBundleLspRuntimeForAttempt(params: {
  toolsEnabled: boolean;
  disableTools?: boolean;
  toolsAllow?: string[];
}): boolean {
  if (!params.toolsEnabled || params.disableTools === true) {
    return false;
  }
  if (!params.toolsAllow) {
    return true;
  }
  if (params.toolsAllow.length === 0) {
    return false;
  }
  if (hasWildcardToolAllowlist(params.toolsAllow)) {
    return true;
  }
  return params.toolsAllow.some((toolName) => {
    const normalized = normalizeToolName(toolName);
    return normalized.startsWith("lsp_");
  });
}
