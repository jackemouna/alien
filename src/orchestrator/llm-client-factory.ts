import { promises as fsp } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createGeminiLlmClient } from "./gemini-llm-client.js";
import { createAnthropicLlmClient } from "./llm-client.js";
import type { LlmClient } from "./llm-client.js";

/**
 * Reads `agents.defaults.{provider, model}` from `~/.alien/alien.json`
 * (set by the /model switcher) and returns an LlmClient for the right
 * provider. Callers don't need to know which provider is configured.
 *
 * Supported providers:
 *   - "anthropic" (default if unset)
 *   - "google"    (Gemini, via createGeminiLlmClient)
 *
 * `openai` is *not* wired here yet — the Anthropic and Gemini paths
 * cover the user's two configured providers. When openai support is
 * needed, drop another case in.
 *
 * Throws the underlying provider client's error when credentials are
 * missing — surfacing the right "go connect this provider" message to
 * the operator.
 */

export type LlmClientResolution = {
  readonly client: LlmClient;
  readonly provider: string;
  readonly model: string;
};

export async function createLlmClientFromConfig(): Promise<LlmClientResolution> {
  const { provider, model } = await readDefaults();
  if (provider === "google") {
    return {
      client: await createGeminiLlmClient({ model }),
      provider,
      model,
    };
  }
  return {
    client: await createAnthropicLlmClient({ model }),
    provider: "anthropic",
    model,
  };
}

type Defaults = { provider: string; model: string };

async function readDefaults(): Promise<Defaults> {
  const stateDir = resolveStateDir(process.env);
  try {
    const raw = await fsp.readFile(path.join(stateDir, "alien.json"), "utf8");
    const cfg = JSON.parse(raw) as {
      agents?: { defaults?: { provider?: unknown; model?: unknown } };
    };
    const provider = cfg.agents?.defaults?.provider;
    const model = cfg.agents?.defaults?.model;
    if (typeof provider === "string" && typeof model === "string") {
      return { provider, model };
    }
  } catch {
    // file may not exist or be partial — fall through to Anthropic default
  }
  return { provider: "anthropic", model: "claude-sonnet-4-6" };
}
