import type { AlienConfig } from "alien/plugin-sdk/config-types";
import type { CommandArgValues } from "alien/plugin-sdk/native-command-registry";

export type DiscordConfig = NonNullable<AlienConfig["channels"]>["discord"];

export type DiscordCommandArgs = {
  raw?: string;
  values?: CommandArgValues;
};
