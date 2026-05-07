import type { AlienConfig } from "alien/plugin-sdk/config-types";
import { inspectSlackAccount } from "./src/account-inspect.js";

export function inspectSlackReadOnlyAccount(cfg: AlienConfig, accountId?: string | null) {
  return inspectSlackAccount({ cfg, accountId });
}
