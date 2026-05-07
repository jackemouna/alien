import type { AlienConfig } from "../config/types.alien.js";

export function isGatewayModelPricingEnabled(config: AlienConfig): boolean {
  return config.models?.pricing?.enabled !== false;
}
