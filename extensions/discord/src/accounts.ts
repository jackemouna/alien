import {
  createAccountActionGate,
  createAccountListHelpers,
  resolveMergedAccountConfig,
} from "alien/plugin-sdk/account-helpers";
import { normalizeAccountId } from "alien/plugin-sdk/account-id";
import {
  mapAllowFromEntries,
  normalizeChannelDmPolicy,
  resolveChannelDmAllowFrom,
  resolveChannelDmPolicy,
  type ChannelDmPolicy,
} from "alien/plugin-sdk/channel-config-helpers";
import { resolveAccountEntry } from "alien/plugin-sdk/routing";
import { normalizeOptionalString } from "alien/plugin-sdk/text-runtime";
import type { DiscordAccountConfig, DiscordActionConfig, AlienConfig } from "./runtime-api.js";
import { selectDiscordRuntimeConfig } from "./runtime-config.js";
import { resolveDiscordToken, type DiscordCredentialStatus } from "./token.js";

export type ResolvedDiscordAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  tokenSource: "env" | "config" | "none";
  tokenStatus: DiscordCredentialStatus;
  config: DiscordAccountConfig;
};

const { listAccountIds, resolveDefaultAccountId } = createAccountListHelpers("discord");
export const listDiscordAccountIds = listAccountIds;
export const resolveDefaultDiscordAccountId = resolveDefaultAccountId;

export function resolveDiscordAccountConfig(
  cfg: AlienConfig,
  accountId: string,
): DiscordAccountConfig | undefined {
  return resolveAccountEntry(cfg.channels?.discord?.accounts, accountId);
}

export function mergeDiscordAccountConfig(
  cfg: AlienConfig,
  accountId: string,
): DiscordAccountConfig {
  return resolveMergedAccountConfig<DiscordAccountConfig>({
    channelConfig: cfg.channels?.discord as DiscordAccountConfig | undefined,
    accounts: cfg.channels?.discord?.accounts as
      | Record<string, Partial<DiscordAccountConfig>>
      | undefined,
    accountId,
  });
}

export function resolveDiscordAccountAllowFrom(params: {
  cfg: AlienConfig;
  accountId?: string | null;
}): string[] | undefined {
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultDiscordAccountId(params.cfg),
  );
  const accountConfig = resolveDiscordAccountConfig(params.cfg, accountId);
  const rootConfig = params.cfg.channels?.discord as DiscordAccountConfig | undefined;

  const allowFrom = resolveChannelDmAllowFrom({
    account: accountConfig as Record<string, unknown> | undefined,
    parent: rootConfig as Record<string, unknown> | undefined,
  });
  return allowFrom ? mapAllowFromEntries(allowFrom) : undefined;
}

export function resolveDiscordAccountDmPolicy(params: {
  cfg: AlienConfig;
  accountId?: string | null;
}): ChannelDmPolicy | undefined {
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultDiscordAccountId(params.cfg),
  );
  const accountConfig = resolveDiscordAccountConfig(params.cfg, accountId);
  const rootConfig = params.cfg.channels?.discord as DiscordAccountConfig | undefined;
  const policy = resolveChannelDmPolicy({
    account: accountConfig as Record<string, unknown> | undefined,
    parent: rootConfig as Record<string, unknown> | undefined,
    defaultPolicy: "pairing",
  });
  return normalizeChannelDmPolicy(policy);
}

export function createDiscordActionGate(params: {
  cfg: AlienConfig;
  accountId?: string | null;
}): (key: keyof DiscordActionConfig, defaultValue?: boolean) => boolean {
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultDiscordAccountId(params.cfg),
  );
  return createAccountActionGate({
    baseActions: params.cfg.channels?.discord?.actions,
    accountActions: resolveDiscordAccountConfig(params.cfg, accountId)?.actions,
  });
}

export function resolveDiscordAccount(params: {
  cfg: AlienConfig;
  accountId?: string | null;
}): ResolvedDiscordAccount {
  const cfg = selectDiscordRuntimeConfig(params.cfg);
  const accountId = normalizeAccountId(params.accountId ?? resolveDefaultDiscordAccountId(cfg));
  const baseEnabled = cfg.channels?.discord?.enabled !== false;
  const merged = mergeDiscordAccountConfig(cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const tokenResolution = resolveDiscordToken(cfg, { accountId });
  return {
    accountId,
    enabled,
    name: normalizeOptionalString(merged.name),
    token: tokenResolution.token,
    tokenSource: tokenResolution.source,
    tokenStatus: tokenResolution.tokenStatus,
    config: merged,
  };
}

export function resolveDiscordMaxLinesPerMessage(params: {
  cfg: AlienConfig;
  discordConfig?: DiscordAccountConfig | null;
  accountId?: string | null;
}): number | undefined {
  if (typeof params.discordConfig?.maxLinesPerMessage === "number") {
    return params.discordConfig.maxLinesPerMessage;
  }
  return resolveDiscordAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  }).config.maxLinesPerMessage;
}

function resolveDiscordAccountTokenOwner(params: {
  cfg: AlienConfig;
  token: string;
}): string | undefined {
  const token = params.token.trim();
  if (!token) {
    return undefined;
  }
  let owner: { accountId: string; priority: number; index: number } | undefined;
  const accountIds = listDiscordAccountIds(params.cfg);
  for (const [index, accountId] of accountIds.entries()) {
    const account = resolveDiscordAccount({ cfg: params.cfg, accountId });
    const accountToken = account.token.trim();
    if (!account.enabled || accountToken !== token) {
      continue;
    }
    const priority = account.tokenSource === "config" ? 2 : account.tokenSource === "env" ? 1 : 0;
    if (!owner || priority > owner.priority) {
      owner = { accountId: account.accountId, priority, index };
      continue;
    }
    if (priority === owner.priority && index < owner.index) {
      owner = { accountId: account.accountId, priority, index };
    }
  }
  return owner?.accountId;
}

function resolveDiscordDuplicateTokenOwner(params: {
  cfg: AlienConfig;
  account: ResolvedDiscordAccount;
}): string | undefined {
  const owner = resolveDiscordAccountTokenOwner({
    cfg: params.cfg,
    token: params.account.token,
  });
  return owner && owner !== params.account.accountId ? owner : undefined;
}

export function isDiscordAccountEnabledForRuntime(
  account: ResolvedDiscordAccount,
  cfg: AlienConfig,
): boolean {
  return account.enabled && !resolveDiscordDuplicateTokenOwner({ cfg, account });
}

export function resolveDiscordAccountDisabledReason(
  account: ResolvedDiscordAccount,
  cfg: AlienConfig,
): string {
  if (!account.enabled) {
    return "disabled";
  }
  const owner = resolveDiscordDuplicateTokenOwner({ cfg, account });
  return owner ? `duplicate bot token; using account "${owner}"` : "disabled";
}

export function listEnabledDiscordAccounts(cfg: AlienConfig): ResolvedDiscordAccount[] {
  return listDiscordAccountIds(cfg)
    .map((accountId) => resolveDiscordAccount({ cfg, accountId }))
    .filter((account) => isDiscordAccountEnabledForRuntime(account, cfg));
}
