import type { AlienConfig } from "alien/plugin-sdk/config-types";
import { inspectDiscordAccount } from "./src/account-inspect.js";

export function inspectDiscordReadOnlyAccount(cfg: AlienConfig, accountId?: string | null) {
  return inspectDiscordAccount({ cfg, accountId });
}
