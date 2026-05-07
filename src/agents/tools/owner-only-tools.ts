export const ALIEN_OWNER_ONLY_CORE_TOOL_NAMES = ["cron", "gateway", "nodes"] as const;

const ALIEN_OWNER_ONLY_CORE_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  ALIEN_OWNER_ONLY_CORE_TOOL_NAMES,
);

export function isAlienOwnerOnlyCoreToolName(toolName: string): boolean {
  return ALIEN_OWNER_ONLY_CORE_TOOL_NAME_SET.has(toolName);
}
