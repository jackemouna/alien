import { normalizeAlienProviderIndex } from "./normalize.js";
import { ALIEN_PROVIDER_INDEX } from "./alien-provider-index.js";
import type { AlienProviderIndex } from "./types.js";

export function loadAlienProviderIndex(
  source: unknown = ALIEN_PROVIDER_INDEX,
): AlienProviderIndex {
  return normalizeAlienProviderIndex(source) ?? { version: 1, providers: {} };
}
