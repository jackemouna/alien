import {
  getRuntimeConfig,
  getRuntimeConfigSourceSnapshot,
  type AlienConfig,
} from "../config/config.js";

export function loadBrowserConfigForRuntimeRefresh(): AlienConfig {
  return getRuntimeConfigSourceSnapshot() ?? getRuntimeConfig();
}
