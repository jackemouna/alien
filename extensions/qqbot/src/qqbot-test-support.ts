import type { AlienConfig } from "alien/plugin-sdk/config-types";

export function makeQqbotSecretRefConfig(): AlienConfig {
  return {
    channels: {
      qqbot: {
        appId: "123456",
        clientSecret: {
          source: "env",
          provider: "default",
          id: "QQBOT_CLIENT_SECRET",
        },
      },
    },
  } as AlienConfig;
}

export function makeQqbotDefaultAccountConfig(): AlienConfig {
  return {
    channels: {
      qqbot: {
        defaultAccount: "bot2",
        accounts: {
          bot2: { appId: "123456" },
        },
      },
    },
  } as AlienConfig;
}
