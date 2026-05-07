import type { AlienConfig } from "../../config/types.js";

export type DirectoryConfigParams = {
  cfg: AlienConfig;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
};
