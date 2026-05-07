/** Root Alien configuration Zod schema — the full `alien.json` shape. */
export { AlienSchema } from "../config/zod-schema.js";
export { validateJsonSchemaValue } from "../plugins/schema-validator.js";
export type { JsonSchemaObject } from "../shared/json-schema.types.js";
