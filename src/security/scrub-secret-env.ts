/**
 * Audit M6: scrub secret-bearing env vars before passing the environment to
 * shell-class child processes (the `exec` tool's host shell, in particular).
 *
 * Without this, a successful prompt-injection that runs `printenv | …` (or a
 * fragment of it inside any larger command) exfiltrates ALIEN_GATEWAY_TOKEN,
 * ANTHROPIC_API_KEY, OPENAI_API_KEY, channel bot tokens, OAuth credentials,
 * etc. The shell tool gives the agent no legitimate reason to read these,
 * since Alien itself authenticates outbound provider/channel calls before
 * the model decides on a tool call.
 *
 * Scrubbing is conservative: any env-var name matching either the explicit
 * service prefix list or a generic "looks like a secret" pattern is dropped.
 * Operators who genuinely need a specific variable in shell calls can pass
 * it via the tool-level `env` override.
 */

const SECRET_NAME_PATTERN = /(?:TOKEN|API_KEY|APIKEY|SECRET|CREDENTIAL|PASSWORD|PRIVATE_KEY)/i;

/**
 * Service prefixes that ship credentials in env vars in upstream Alien's
 * .env.example. Any var starting with one of these prefixes is dropped
 * regardless of whether the suffix matches the secret-name pattern, so
 * non-obvious names like `ALIEN_AUTH_*`, `OPENAI_ORG_ID`, etc. are still
 * caught.
 */
const SECRET_PREFIXES: readonly string[] = [
  "ALIEN_",
  "ANTHROPIC_",
  "OPENAI_",
  "AZURE_OPENAI_",
  "GOOGLE_API_",
  "GOOGLE_GENAI_",
  "GEMINI_",
  "AWS_BEDROCK_",
  "AWS_ACCESS_",
  "AWS_SECRET_",
  "AWS_SESSION_",
  "BEDROCK_",
  "VERCEL_AI_",
  "CLOUDFLARE_AI_",
  "MISTRAL_",
  "CEREBRAS_",
  "OPENROUTER_",
  "PERPLEXITY_",
  "TAVILY_",
  "FIRECRAWL_",
  "BRAVE_",
  "VOYAGE_",
  "ELEVENLABS_",
  "DEEPGRAM_",
  "INWORLD_",
  "XI_",
  "FAL_",
  "RUNWAY_",
  "ZAI_",
  "XIAOMI_",
  "NVIDIA_",
  "STEPFUN_",
  "SLACK_",
  "DISCORD_",
  "TELEGRAM_",
  "WHATSAPP_",
  "MATRIX_",
  "MATTERMOST_",
  "SIGNAL_",
  "TWITCH_",
  "NOSTR_",
  "ZALO_",
  "SYNOLOGY_",
  "TLON_",
  "LITELLM_",
  "OPENCODE_",
  "GITHUB_",
];

/**
 * Returns a copy of `env` with secret-bearing variables removed.
 *
 * Pure: no I/O, no mutation of the input.
 */
export function scrubSecretEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (isSecretEnvName(key)) {
      continue;
    }
    scrubbed[key] = value;
  }
  return scrubbed;
}

/**
 * Same as `scrubSecretEnv` but also returns the names of the variables
 * that were dropped, for diagnostic logging.
 */
export function scrubSecretEnvWithDiagnostics(env: NodeJS.ProcessEnv): {
  env: NodeJS.ProcessEnv;
  dropped: string[];
} {
  const scrubbed: NodeJS.ProcessEnv = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (isSecretEnvName(key)) {
      dropped.push(key);
      continue;
    }
    scrubbed[key] = value;
  }
  return { env: scrubbed, dropped };
}

export function isSecretEnvName(name: string): boolean {
  for (const prefix of SECRET_PREFIXES) {
    if (name.startsWith(prefix)) {
      return true;
    }
  }
  return SECRET_NAME_PATTERN.test(name);
}
