import { runChannelPluginStartupMaintenance } from "../channels/plugins/lifecycle-startup.js";
import type { AlienConfig } from "../config/types.alien.js";

type DoctorStartupMaintenanceRuntime = {
  error: (message: string) => void;
  log: (message: string) => void;
};

type ChannelPluginStartupMaintenanceRunner = typeof runChannelPluginStartupMaintenance;

export async function maybeRunDoctorStartupChannelMaintenance(params: {
  cfg: AlienConfig;
  env?: NodeJS.ProcessEnv;
  runChannelPluginStartupMaintenance?: ChannelPluginStartupMaintenanceRunner;
  runtime: DoctorStartupMaintenanceRuntime;
  shouldRepair: boolean;
}): Promise<void> {
  if (!params.shouldRepair) {
    return;
  }
  const runStartupMaintenance =
    params.runChannelPluginStartupMaintenance ?? runChannelPluginStartupMaintenance;
  await runStartupMaintenance({
    cfg: params.cfg,
    env: params.env ?? process.env,
    log: {
      info: (message) => params.runtime.log(message),
      warn: (message) => params.runtime.error(message),
    },
    trigger: "doctor-fix",
    logPrefix: "doctor",
  });
}
