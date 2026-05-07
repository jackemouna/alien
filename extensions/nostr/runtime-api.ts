// Private runtime barrel for the bundled Nostr extension.
// Keep this barrel thin and aligned with the local extension surface.

export type { AlienConfig } from "alien/plugin-sdk/config-types";
export { getPluginRuntimeGatewayRequestScope } from "alien/plugin-sdk/plugin-runtime";
export type { PluginRuntime } from "alien/plugin-sdk/runtime-store";
