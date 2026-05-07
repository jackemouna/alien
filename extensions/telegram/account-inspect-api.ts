import type { AlienConfig } from "./runtime-api.js";
import { inspectTelegramAccount } from "./src/account-inspect.js";

export function inspectTelegramReadOnlyAccount(cfg: AlienConfig, accountId?: string | null) {
  return inspectTelegramAccount({ cfg, accountId });
}
