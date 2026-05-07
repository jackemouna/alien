import { buildManifestModelProviderConfig } from "alien/plugin-sdk/provider-catalog-shared";
import type { ModelProviderConfig } from "alien/plugin-sdk/provider-model-shared";
import manifest from "./alien.plugin.json" with { type: "json" };

export function buildMistralProvider(): ModelProviderConfig {
  return buildManifestModelProviderConfig({
    providerId: "mistral",
    catalog: manifest.modelCatalog.providers.mistral,
  });
}
