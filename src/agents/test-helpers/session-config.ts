import type { AlienConfig } from "../../config/types.alien.js";

export function createPerSenderSessionConfig(
  overrides: Partial<NonNullable<AlienConfig["session"]>> = {},
): NonNullable<AlienConfig["session"]> {
  return {
    mainKey: "main",
    scope: "per-sender",
    ...overrides,
  };
}
