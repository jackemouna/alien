export { clearAccountEntryFields } from "alien/plugin-sdk/core";
import { DEFAULT_ACCOUNT_ID } from "alien/plugin-sdk/account-id";
import type { AlienConfig } from "alien/plugin-sdk/account-resolution";
import type { ChannelPlugin } from "alien/plugin-sdk/core";
import { listLineAccountIds, resolveDefaultLineAccountId, resolveLineAccount } from "./accounts.js";
import { resolveExactLineGroupConfigKey } from "./group-keys.js";
import type { LineConfig, ResolvedLineAccount } from "./types.js";

export {
  DEFAULT_ACCOUNT_ID,
  listLineAccountIds,
  resolveDefaultLineAccountId,
  resolveExactLineGroupConfigKey,
  resolveLineAccount,
};

export type { ChannelPlugin, LineConfig, AlienConfig, ResolvedLineAccount };
