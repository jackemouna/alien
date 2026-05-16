/**
 * Minimal LLM client interface used by orchestrator workers. Production
 * implementations wrap Anthropic / OpenAI / etc.; tests inject a stub that
 * returns canned strings.
 *
 * Kept intentionally small — the orchestrator does not need streaming,
 * tool-use, or vision for the MVP. When workers need richer capabilities
 * (e.g. web search, image generation), add them as separate clients rather
 * than growing this surface.
 */

export type LlmCompletionRequest = {
  /** System prompt establishing the worker role. */
  readonly system?: string;
  /** User content the worker is acting on. */
  readonly user: string;
  /** Soft cap on response length. Workers should keep this small. */
  readonly maxTokens?: number;
  /** Identifier for diagnostics — typically the worker role. */
  readonly purpose?: string;
  /** Forwarded to the underlying SDK; allows aborting long calls. */
  readonly signal?: AbortSignal;
};

export type LlmUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Model id the request actually ran against (for downstream pricing). */
  readonly model: string;
};

export type LlmCompletionResult = {
  readonly text: string;
  readonly usage?: LlmUsage;
};

export type LlmClient = {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
};

/**
 * Anthropic-backed implementation. Three credential paths, in order:
 *
 *   1. The setup wizard's Claude OAuth credentials at
 *      `~/.alien/anthropic-oauth.json` — used when the operator signs in
 *      with their Pro/Max subscription so inference is billed against
 *      that subscription instead of metered API. Tokens auto-refresh.
 *   2. `ANTHROPIC_API_KEY` env var.
 *   3. macOS Keychain / Linux libsecret entry
 *      `service=alien.ai`, `account=anthropic-api-key`.
 *
 * The OAuth path detects the `sk-ant-oat-` prefix and sends the token as
 * `Authorization: Bearer ...` with the OAuth beta header; the SDK's
 * `authToken` option does both. The API-key path uses `x-api-key` the
 * conventional way.
 */
export type CreateAnthropicLlmClientOptions = {
  readonly apiKey?: string;
  readonly model?: string;
  readonly defaultMaxTokens?: number;
};

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;

export const ANTHROPIC_API_KEY_KEYCHAIN_SERVICE = "alien.ai";
export const ANTHROPIC_API_KEY_KEYCHAIN_ACCOUNT = "anthropic-api-key";

const ANTHROPIC_OAUTH_BETA_HEADER = "oauth-2025-04-20,claude-code-20250219";

function isAnthropicOAuthToken(token: string): boolean {
  return token.startsWith("sk-ant-oat-");
}

async function resolveAnthropicAuth(
  options: CreateAnthropicLlmClientOptions,
): Promise<{ kind: "oauth" | "api-key"; token: string } | null> {
  if (options.apiKey) {
    return {
      kind: isAnthropicOAuthToken(options.apiKey) ? "oauth" : "api-key",
      token: options.apiKey,
    };
  }
  // FIRST CHOICE: piggyback on an installed Claude Code session.
  // Anthropic treats requests carrying the Claude Code OAuth identity
  // as Claude Code itself — billing applies to the operator's Pro/Max
  // subscription, not the "third-party app extra usage" pool. This is
  // the answer to "make it use the subscription I pay for."
  const { readClaudeCodeSession, isClaudeCodeSessionExpiringSoon } =
    await import("../security/claude-code-session.js");
  const ccSession = readClaudeCodeSession();
  if (ccSession && !isClaudeCodeSessionExpiringSoon(ccSession)) {
    return { kind: "oauth", token: ccSession.accessToken };
  }
  // SECOND CHOICE: wizard-OAuth session at ~/.alien/anthropic-oauth.json.
  // Same token shape, but Anthropic bills the user's "extra usage" pool
  // for these. Caller will see a 400 with that message if they haven't
  // topped up.
  const { readAnthropicOAuth, shouldRefresh, writeAnthropicOAuth } =
    await import("../security/anthropic-oauth-store.js");
  const stored = await readAnthropicOAuth();
  if (stored) {
    if (shouldRefresh(stored)) {
      try {
        const { refreshAnthropicToken } = await import("@mariozechner/pi-ai/oauth");
        const refreshed = await refreshAnthropicToken(stored.refresh);
        const next = {
          access: refreshed.access,
          refresh: refreshed.refresh ?? stored.refresh,
          expires: refreshed.expires,
        };
        await writeAnthropicOAuth(next);
        return { kind: "oauth", token: next.access };
      } catch {
        // Fall through and try env / keychain. The wizard will catch
        // the next time the user opens /setup.
      }
    } else {
      return { kind: "oauth", token: stored.access };
    }
  }
  // THIRD CHOICE: env-var or keychain-stored regular API key.
  const { readSecretFromEnvOrKeychain } = await import("../security/secret-source.js");
  const fromEnv = readSecretFromEnvOrKeychain({
    envVarName: "ANTHROPIC_API_KEY",
    keychain: {
      service: ANTHROPIC_API_KEY_KEYCHAIN_SERVICE,
      account: ANTHROPIC_API_KEY_KEYCHAIN_ACCOUNT,
    },
    keychainGate: "always",
  });
  if (!fromEnv) return null;
  return { kind: isAnthropicOAuthToken(fromEnv) ? "oauth" : "api-key", token: fromEnv };
}

export async function createAnthropicLlmClient(
  options: CreateAnthropicLlmClientOptions = {},
): Promise<LlmClient> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const auth = await resolveAnthropicAuth(options);
  if (!auth) {
    throw new Error(
      "createAnthropicLlmClient: no Anthropic credentials. Open the setup wizard at /setup to sign in with Claude or paste an API key.",
    );
  }
  const client =
    auth.kind === "oauth"
      ? new Anthropic({
          apiKey: null,
          authToken: auth.token,
          defaultHeaders: { "anthropic-beta": ANTHROPIC_OAUTH_BETA_HEADER },
        })
      : new Anthropic({ apiKey: auth.token });
  const model = options.model ?? DEFAULT_MODEL;
  const defaultMaxTokens = options.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
      const message = await client.messages.create(
        {
          model,
          max_tokens: req.maxTokens ?? defaultMaxTokens,
          ...(req.system ? { system: req.system } : {}),
          messages: [{ role: "user", content: req.user }],
        },
        req.signal ? { signal: req.signal } : undefined,
      );
      const text = collectTextContent(message.content);
      const usage = readUsageFromAnthropic(message, model);
      return usage ? { text, usage } : { text };
    },
  };
}

/**
 * Test helper. The responder can return either a plain string (legacy) or
 * a full `LlmCompletionResult` to control returned usage.
 */
export function createStubLlmClient(
  respond: (
    request: LlmCompletionRequest,
  ) => string | LlmCompletionResult | Promise<string | LlmCompletionResult>,
): LlmClient {
  return {
    async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
      const value = await Promise.resolve(respond(request));
      if (typeof value === "string") {
        return { text: value };
      }
      return value;
    },
  };
}

type AnthropicContentBlock = {
  type: string;
  text?: string;
};

type AnthropicMessageUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

function collectTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((block): block is AnthropicContentBlock => Boolean(block) && typeof block === "object")
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

function readUsageFromAnthropic(
  message: { usage?: AnthropicMessageUsage; model?: string } | undefined | null,
  fallbackModel: string,
): LlmUsage | undefined {
  if (!message || !message.usage) return undefined;
  const inputTokens = message.usage.input_tokens ?? 0;
  const outputTokens = message.usage.output_tokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  return {
    inputTokens,
    outputTokens,
    model: typeof message.model === "string" && message.model ? message.model : fallbackModel,
  };
}
