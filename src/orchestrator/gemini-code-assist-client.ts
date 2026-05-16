import { randomUUID } from "node:crypto";
import { logWarn } from "../logger.js";
import {
  readGeminiOAuth,
  resolveGeminiOAuthPath,
  writeGeminiOAuth,
  type GeminiOAuthCredentials,
} from "../security/gemini-oauth-store.js";
import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from "./llm-client.js";

/**
 * Google Code Assist client for Gemini — the "free, just sign in" path.
 *
 * Reads ~/.alien/gemini-oauth.json (written by the wizard's "Sign in
 * with Google" flow), auto-refreshes the access token when expired, and
 * calls `cloudcode-pa.googleapis.com/v1internal:generateContent` with
 * the user's Google account. This is the same surface the official
 * Gemini CLI uses for its free tier.
 *
 * Boundary note: pulls Gemini CLI OAuth client credentials from the
 * bundled google plugin (`extensions/google/oauth.credentials.js`) via
 * dynamic import — same pragmatic crossing already used for
 * loginGeminiCliOAuth in setup-http. Long-term fix is a Plugin SDK seam.
 *
 * Per the gemini-cli source the request body shape is:
 *   { model, project, user_prompt_id, request: { contents,
 *     systemInstruction, generationConfig, session_id } }
 * And the response wraps the standard generateContent shape inside
 * `{ response: { candidates, usageMetadata, modelVersion } }`.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CODE_ASSIST_API_VERSION = "v1internal";
const REFRESH_SLACK_MS = 60_000;

export type CreateGeminiCodeAssistClientOptions = {
  readonly model?: string;
};

const DEFAULT_MODEL = "gemini-2.5-flash";

/**
 * Returns a Code Assist–backed LlmClient if the OAuth file is present
 * and the Gemini CLI client credentials can be located. Returns null
 * when either is missing so the caller can fall back to the API-key
 * client without surfacing a confusing error.
 */
export async function tryCreateGeminiCodeAssistClient(
  opts: CreateGeminiCodeAssistClientOptions = {},
): Promise<LlmClient | null> {
  const creds = await readGeminiOAuth();
  if (!creds) return null;
  if (!creds.projectId) {
    // Without a projectId we can't talk to Code Assist. The wizard's
    // login flow normally fills it in; if missing, suggest re-signing.
    logWarn(
      `gemini-code-assist: oauth file ${resolveGeminiOAuthPath()} has no projectId — sign in again or paste an API key.`,
    );
    return null;
  }
  const clientCreds = await resolveGeminiCliClientCredentials();
  if (!clientCreds) {
    logWarn(
      "gemini-code-assist: Gemini CLI client credentials missing. Install gemini-cli or set GEMINI_CLI_OAUTH_CLIENT_ID + GEMINI_CLI_OAUTH_CLIENT_SECRET.",
    );
    return null;
  }
  const model = opts.model ?? DEFAULT_MODEL;
  let active: GeminiOAuthCredentials = creds;

  return {
    async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
      active = await ensureFreshToken(active, clientCreds);
      const body = {
        model,
        project: active.projectId,
        user_prompt_id: randomUUID(),
        request: {
          contents: [{ role: "user", parts: [{ text: request.user }] }],
          ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
          generationConfig: {
            maxOutputTokens: request.maxTokens ?? 1024,
            temperature: 0.2,
          },
          session_id: randomUUID(),
        },
      };
      const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:generateContent`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${active.access}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Gemini Code Assist ${res.status}: ${text.slice(0, 400)}`);
      }
      const json = (await res.json()) as CodeAssistResponse;
      const inner = json.response;
      const candidate = inner?.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const usage = inner?.usageMetadata
        ? {
            inputTokens: inner.usageMetadata.promptTokenCount ?? 0,
            outputTokens: inner.usageMetadata.candidatesTokenCount ?? 0,
            model: inner.modelVersion ?? model,
          }
        : undefined;
      return usage ? { text, usage } : { text };
    },
  };
}

// ---- token refresh ----

type ClientCreds = { clientId: string; clientSecret: string };

async function ensureFreshToken(
  creds: GeminiOAuthCredentials,
  client: ClientCreds,
): Promise<GeminiOAuthCredentials> {
  if (creds.expires > Date.now() + REFRESH_SLACK_MS) {
    return creds;
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refresh,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Gemini OAuth refresh failed (${res.status}): ${text.slice(0, 300)}. ` +
        `Re-sign in with Google on /integrations to recover, or paste an API key.`,
    );
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  if (typeof data.access_token !== "string" || typeof data.expires_in !== "number") {
    throw new Error("Gemini OAuth refresh: malformed response");
  }
  const next: GeminiOAuthCredentials = {
    ...creds,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000,
  };
  await writeGeminiOAuth(next);
  return next;
}

async function resolveGeminiCliClientCredentials(): Promise<ClientCreds | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any;
  try {
    mod = await import("../../extensions/google/oauth.credentials.js");
  } catch {
    return null;
  }
  try {
    const out = mod.resolveOAuthClientConfig() as { clientId: string; clientSecret?: string };
    if (!out.clientId || !out.clientSecret) return null;
    return { clientId: out.clientId, clientSecret: out.clientSecret };
  } catch {
    return null;
  }
}

// ---- response shape ----

type CodeAssistResponse = {
  readonly response?: {
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
};
