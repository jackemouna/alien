import type { AlienConfig } from "alien/plugin-sdk/config-types";

export type IMessageAccountConfig = Omit<
  NonNullable<NonNullable<AlienConfig["channels"]>["imessage"]>,
  "accounts" | "defaultAccount"
>;
