import type { AlienConfig } from "alien/plugin-sdk/config-types";

export type WhatsAppAccountConfig = NonNullable<
  NonNullable<NonNullable<AlienConfig["channels"]>["whatsapp"]>["accounts"]
>[string];
