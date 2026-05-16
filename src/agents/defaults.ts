// Defaults for agent metadata when upstream does not supply them.
//
// Alien is Anthropic-first: the setup wizard leads with "Sign in with
// Claude" and the orchestrator workers are tuned around Claude models.
// Defaulting to Anthropic means a fresh install where the operator only
// connected the Claude subscription Just Works without any model config.
// Operators who prefer OpenAI override via alien.json or the agents UI.
export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-sonnet-4-6";
// Conservative fallback used when model metadata is unavailable.
export const DEFAULT_CONTEXT_TOKENS = 200_000;
