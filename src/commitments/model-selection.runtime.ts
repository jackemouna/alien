import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import type { AlienConfig } from "../config/config.js";

export function resolveCommitmentDefaultModelRef(params: {
  cfg: AlienConfig;
  agentId?: string;
}): { provider: string; model: string } {
  return resolveDefaultModelForAgent(params);
}
