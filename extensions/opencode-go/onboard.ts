import {
  applyAgentDefaultModelPrimary,
  type AlienConfig,
} from "alien/plugin-sdk/provider-onboard";

export const OPENCODE_GO_DEFAULT_MODEL_REF = "opencode-go/kimi-k2.6";

export function applyOpencodeGoProviderConfig(cfg: AlienConfig): AlienConfig {
  return cfg;
}

export function applyOpencodeGoConfig(cfg: AlienConfig): AlienConfig {
  return applyAgentDefaultModelPrimary(
    applyOpencodeGoProviderConfig(cfg),
    OPENCODE_GO_DEFAULT_MODEL_REF,
  );
}
