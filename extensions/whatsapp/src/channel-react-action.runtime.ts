import { readStringOrNumberParam, readStringParam } from "alien/plugin-sdk/channel-actions";
import type { AlienConfig } from "alien/plugin-sdk/config-types";

export { resolveReactionMessageId } from "alien/plugin-sdk/channel-actions";
export { handleWhatsAppAction } from "./action-runtime.js";
export { isWhatsAppGroupJid, normalizeWhatsAppTarget } from "./normalize.js";
export { readStringOrNumberParam, readStringParam, type AlienConfig };
