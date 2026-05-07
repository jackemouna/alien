import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "alien/plugin-sdk/account-id";
import type { ChannelSetupAdapter } from "alien/plugin-sdk/channel-setup";
import type { AlienConfig } from "alien/plugin-sdk/config-types";
import {
  applyAccountNameToChannelSection,
  applySetupAccountConfigPatch,
  migrateBaseNameToDefaultAccount,
} from "alien/plugin-sdk/setup";
import { createSetupInputPresenceValidator } from "alien/plugin-sdk/setup-runtime";
import {
  resolveMattermostAccount,
  type ResolvedMattermostAccount,
} from "./setup.accounts.runtime.js";
import { normalizeMattermostBaseUrl } from "./setup.client.runtime.js";
import { hasConfiguredSecretInput } from "./setup.secret-input.runtime.js";

const channel = "mattermost" as const;

export function isMattermostConfigured(account: ResolvedMattermostAccount): boolean {
  const tokenConfigured =
    Boolean(account.botToken?.trim()) || hasConfiguredSecretInput(account.config.botToken);
  return tokenConfigured && Boolean(account.baseUrl);
}

export function resolveMattermostAccountWithSecrets(cfg: AlienConfig, accountId: string) {
  return resolveMattermostAccount({
    cfg,
    accountId,
    allowUnresolvedSecretRef: true,
  });
}

export function applyMattermostSetupConfigPatch(params: {
  cfg: AlienConfig;
  accountId: string;
  name?: string;
  patch: Record<string, unknown>;
}): AlienConfig {
  const namedConfig = applyAccountNameToChannelSection({
    cfg: params.cfg,
    channelKey: channel,
    accountId: params.accountId,
    name: params.name,
  });
  const next =
    params.accountId !== DEFAULT_ACCOUNT_ID
      ? migrateBaseNameToDefaultAccount({
          cfg: namedConfig,
          channelKey: channel,
        })
      : namedConfig;
  return applySetupAccountConfigPatch({
    cfg: next,
    channelKey: channel,
    accountId: params.accountId,
    patch: params.patch,
  });
}

export const mattermostSetupAdapter: ChannelSetupAdapter = {
  resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
  applyAccountName: ({ cfg, accountId, name }) =>
    applyAccountNameToChannelSection({
      cfg,
      channelKey: channel,
      accountId,
      name,
    }),
  validateInput: createSetupInputPresenceValidator({
    defaultAccountOnlyEnvError: "Mattermost env vars can only be used for the default account.",
    whenNotUseEnv: [
      {
        someOf: ["botToken", "token"],
        message: "Mattermost requires --bot-token and --http-url (or --use-env).",
      },
      {
        someOf: ["httpUrl"],
        message: "Mattermost requires --bot-token and --http-url (or --use-env).",
      },
    ],
    validate: ({ input }) => {
      const token = input.botToken ?? input.token;
      const baseUrl = normalizeMattermostBaseUrl(input.httpUrl);
      if (!input.useEnv && (!token || !baseUrl)) {
        return "Mattermost requires --bot-token and --http-url (or --use-env).";
      }
      if (input.httpUrl && !baseUrl) {
        return "Mattermost --http-url must include a valid base URL.";
      }
      return null;
    },
  }),
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const token = input.botToken ?? input.token;
    const baseUrl = normalizeMattermostBaseUrl(input.httpUrl);
    return applyMattermostSetupConfigPatch({
      cfg,
      accountId,
      name: input.name,
      patch: input.useEnv
        ? {}
        : {
            ...(token ? { botToken: token } : {}),
            ...(baseUrl ? { baseUrl } : {}),
          },
    });
  },
};
