import { buildManifestModelProviderConfig } from "alien/plugin-sdk/provider-catalog-shared";
import type { ModelProviderConfig } from "alien/plugin-sdk/provider-model-shared";
import manifest from "./alien.plugin.json" with { type: "json" };

export function buildTogetherProvider(): ModelProviderConfig {
  return buildManifestModelProviderConfig({
    providerId: "together",
    catalog: manifest.modelCatalog.providers.together,
  });
}
