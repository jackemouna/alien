import type { AlienConfig } from "alien/plugin-sdk/config-types";

export type SignalAccountConfig = Omit<
  Exclude<NonNullable<AlienConfig["channels"]>["signal"], undefined>,
  "accounts"
>;
