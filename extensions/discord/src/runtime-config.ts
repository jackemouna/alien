import {
  getRuntimeConfigSnapshot,
  getRuntimeConfigSourceSnapshot,
  selectApplicableRuntimeConfig,
} from "alien/plugin-sdk/runtime-config-snapshot";
import type { AlienConfig } from "./runtime-api.js";

export function selectDiscordRuntimeConfig(inputConfig: AlienConfig): AlienConfig {
  return (
    selectApplicableRuntimeConfig({
      inputConfig,
      runtimeConfig: getRuntimeConfigSnapshot(),
      runtimeSourceConfig: getRuntimeConfigSourceSnapshot(),
    }) ?? inputConfig
  );
}
