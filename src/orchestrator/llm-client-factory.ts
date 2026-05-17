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
  if (provider === "google-gemini-cli") {
    // Code Assist OAuth path — much higher free-tier quota than the
    // public Generative Language API. createGeminiLlmClient tries the
    // API key first and falls back to Code Assist when none is set; for
    // an explicit google-gemini-cli pick we want Code Assist regardless.
    const { tryCreateGeminiCodeAssistClient } = await import("./gemini-code-assist-client.js");
    const ca = await tryCreateGeminiCodeAssistClient({ model });
    if (ca) return { client: ca, provider, model };
    // Fall through to the API-key client with a clear error if OAuth
    // setup is incomplete.
    return {
      client: await createGeminiLlmClient({ model }),
      provider,
      model,
    };
  }
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
      agents?: { defaults?: { model?: unknown; provider?: unknown } };
    };
    const model = cfg.agents?.defaults?.model;
    // Modern format: "provider/model"
    if (typeof model === "string") {
      const slash = model.indexOf("/");
      if (slash > 0) {
        return { provider: model.slice(0, slash), model: model.slice(slash + 1) };
      }
    }
    // Legacy format: split provider + model
    const legacyProvider = cfg.agents?.defaults?.provider;
    if (typeof legacyProvider === "string" && typeof model === "string") {
      return { provider: legacyProvider, model };
    }
  } catch {
    // file may not exist or be partial — fall through to Anthropic default
  }
  return { provider: "anthropic", model: "claude-sonnet-4-6" };
}
