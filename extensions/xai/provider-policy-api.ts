import type { ProviderThinkingProfile } from "alien/plugin-sdk/plugin-entry";

export function resolveThinkingProfile(): ProviderThinkingProfile {
  return { levels: [{ id: "off" }], defaultLevel: "off" };
}
