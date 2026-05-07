import type { MarkdownTableMode } from "./types.base.js";
import type { AlienConfig } from "./types.alien.js";

export type ResolveMarkdownTableModeParams = {
  cfg?: Partial<AlienConfig>;
  channel?: string | null;
  accountId?: string | null;
};

export type ResolveMarkdownTableMode = (
  params: ResolveMarkdownTableModeParams,
) => MarkdownTableMode;
