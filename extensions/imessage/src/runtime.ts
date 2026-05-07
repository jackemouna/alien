import type { PluginRuntime } from "alien/plugin-sdk/core";
import { createPluginRuntimeStore } from "alien/plugin-sdk/runtime-store";

const { setRuntime: setIMessageRuntime } = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "imessage",
  errorMessage: "iMessage runtime not initialized",
});
export { setIMessageRuntime };
