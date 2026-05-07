export type { ChannelPlugin, AlienPluginApi, PluginRuntime } from "alien/plugin-sdk/core";
export type { AlienConfig } from "alien/plugin-sdk/config-types";
export type {
  AlienPluginService,
  AlienPluginServiceContext,
  PluginLogger,
} from "alien/plugin-sdk/core";
export type { ResolvedQQBotAccount, QQBotAccountConfig } from "./src/types.js";
export { getQQBotRuntime, setQQBotRuntime } from "./src/bridge/runtime.js";
