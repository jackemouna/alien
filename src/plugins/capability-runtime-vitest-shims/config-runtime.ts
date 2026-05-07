import { resolveActiveTalkProviderConfig } from "../../config/talk.js";
import type { AlienConfig } from "../../config/types.js";

export { resolveActiveTalkProviderConfig };

export function getRuntimeConfigSnapshot(): AlienConfig | null {
  return null;
}
