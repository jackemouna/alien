import type { AlienConfig } from "../../config/types.alien.js";
import {
  hasBundledChannelPackageState,
  listBundledChannelIdsForPackageState,
} from "./package-state-probes.js";

export function listBundledChannelIdsWithConfiguredState(): string[] {
  return listBundledChannelIdsForPackageState("configuredState");
}

export function hasBundledChannelConfiguredState(params: {
  channelId: string;
  cfg: AlienConfig;
  env?: NodeJS.ProcessEnv;
}): boolean {
  return hasBundledChannelPackageState({
    metadataKey: "configuredState",
    channelId: params.channelId,
    cfg: params.cfg,
    env: params.env,
  });
}
