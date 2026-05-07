import type { AlienConfig } from "alien/plugin-sdk/config-types";
import type { CommandsPort } from "../adapter/commands.port.js";
import { initCommands } from "./slash-commands-impl.js";

type RuntimeConfigApi = ReturnType<NonNullable<CommandsPort["approveRuntimeGetter"]>>["config"];
type ReplaceConfigFile = RuntimeConfigApi["replaceConfigFile"];
type ReplaceConfigFileResult = Awaited<ReturnType<ReplaceConfigFile>>;

export type WrittenQQBotConfig = {
  streaming?: unknown;
  accounts?: { default?: { streaming?: unknown } };
};

export function installCommandRuntime(
  currentConfig: AlienConfig,
  writes: AlienConfig[],
): void {
  const replaceConfigFile: ReplaceConfigFile = async (params) => {
    writes.push(params.nextConfig);
    return undefined as unknown as ReplaceConfigFileResult;
  };

  initCommands({
    resolveVersion: () => "test",
    pluginVersion: "0.0.0-test",
    approveRuntimeGetter: () => ({
      config: {
        current: () => currentConfig,
        replaceConfigFile,
      },
    }),
  });
}

export function getWrittenQQBotConfig(
  write: AlienConfig | undefined,
): WrittenQQBotConfig | undefined {
  return write?.channels?.qqbot as WrittenQQBotConfig | undefined;
}
