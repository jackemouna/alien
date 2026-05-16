import { resolveGeminiOAuthPath } from "../security/gemini-oauth-store.js";
import { readSecretFromEnvOrKeychain } from "../security/secret-source.js";
import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from "./llm-client.js";

/**
 * Minimal Google Gemini LLM client. Uses the v1beta generateContent
 * endpoint with API-key auth (the same key /integrations stores in
 * keychain `alien.ai/gemini-api-key` or env `GEMINI_API_KEY` /
 * `GOOGLE_API_KEY`).
 *
 * The Gemini-CLI OAuth path is intentionally NOT supported here — that
 * sign-in flow grants `cloud-platform` scope for Google's Code Assist
 * endpoint (cloudcode-pa.googleapis.com), NOT the public Generative
 * Language API (generativelanguage.googleapis.com) we call. If the
 * operator has only signed in via OAuth, this client surfaces an
 * explicit error pointing at /integrations to paste an API key.
 *
 * The result.usage.model is set from the response's modelVersion (or
 * the requested model if Google doesn't echo it back).
 */

const DEFAULT_MODEL = "gemini-2.5-flash";

export type CreateGeminiLlmClientOptions = {
  readonly apiKey?: string;
  readonly model?: string;
  readonly defaultMaxTokens?: number;
};

const GEMINI_KEYCHAIN = { service: "alien.ai", account: "gemini-api-key" } as const;

export async function createGeminiLlmClient(
  opts: CreateGeminiLlmClientOptions = {},
): Promise<LlmClient> {
  const model = opts.model ?? DEFAULT_MODEL;
  const apiKey =
    opts.apiKey ??
    readSecretFromEnvOrKeychain({
      envVarName: "GEMINI_API_KEY",
      keychain: GEMINI_KEYCHAIN,
      keychainGate: "always",
    }) ??
    readSecretFromEnvOrKeychain({
      envVarName: "GOOGLE_API_KEY",
      keychain: GEMINI_KEYCHAIN,
      keychainGate: "always",
    });
  if (!apiKey) {
    // Detect the "Sign in with Google" case and steer the operator to
    // the API-key path. The OAuth token at gemini-oauth.json is scoped
    // for Code Assist (cloudcode-pa) — it won't authorize the public
    // generateContent endpoint Alien's brain uses.
    const oauthOnly = await oauthFilePresent();
    if (oauthOnly) {
      throw new Error(
        "Gemini sign-in is for Google Code Assist — it does NOT authorize the public " +
          "Generative Language API that Alien's brain calls. Paste a free API key from " +
          "https://aistudio.google.com/apikey on /integrations (takes 30 seconds) and Gemini " +
          "will start answering for every mission.",
      );
    }
    throw new Error(
      "No Gemini credentials. Open /integrations and paste a key from " +
        "https://aistudio.google.com/apikey.",
    );
  }

  return {
    async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
        `?key=${encodeURIComponent(apiKey)}`;

      const body: Record<string, unknown> = {
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig: {
          maxOutputTokens: request.maxTokens ?? opts.defaultMaxTokens ?? 1024,
          temperature: 0.2,
        },
      };
      if (request.system) {
        body.systemInstruction = { parts: [{ text: request.system }] };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(request.signal ? { signal: request.signal } : {}),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Gemini API ${res.status}: ${text.slice(0, 400)}`);
      }

      const json = (await res.json()) as GeminiResponse;
      const candidate = json.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const usage = json.usageMetadata
        ? {
            inputTokens: json.usageMetadata.promptTokenCount ?? 0,
            outputTokens: json.usageMetadata.candidatesTokenCount ?? 0,
            model: json.modelVersion ?? model,
          }
        : undefined;
      return usage ? { text, usage } : { text };
    },
  };
}

async function oauthFilePresent(): Promise<boolean> {
  const { promises: fsp } = await import("node:fs");
  try {
    await fsp.access(resolveGeminiOAuthPath());
    return true;
  } catch {
    return false;
  }
}

type GeminiResponse = {
  readonly candidates?: ReadonlyArray<{
    readonly content?: {
      readonly parts?: ReadonlyArray<{ readonly text?: string }>;
    };
  }>;
  readonly modelVersion?: string;
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
  };
};
