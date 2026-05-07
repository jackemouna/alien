import type { ProviderPlugin } from "alien/plugin-sdk/provider-model-shared";
import { buildMoonshotProvider } from "./provider-catalog.js";

const moonshotProviderDiscovery: ProviderPlugin = {
  id: "moonshot",
  label: "Moonshot",
  docsPath: "/providers/moonshot",
  auth: [],
  staticCatalog: {
    order: "simple",
    run: async () => ({
      provider: buildMoonshotProvider(),
    }),
  },
};

export default moonshotProviderDiscovery;
