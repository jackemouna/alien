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
 * Anthropic-backed implementation. Reads ANTHROPIC_API_KEY from the env
 * first; if absent and the operator has opted into keychain-backed secrets
 * (`ALIEN_SECRETS_FROM_KEYCHAIN=1`), falls back to the macOS Keychain /
 * Linux libsecret entry `service=alien.ai`, `account=anthropic-api-key`.
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

export async function createAnthropicLlmClient(
  options: CreateAnthropicLlmClientOptions = {},
): Promise<LlmClient> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { readSecretFromEnvOrKeychain } = await import("../security/secret-source.js");
  const apiKey =
    options.apiKey ??
    readSecretFromEnvOrKeychain({
      envVarName: "ANTHROPIC_API_KEY",
      keychain: {
        service: ANTHROPIC_API_KEY_KEYCHAIN_SERVICE,
        account: ANTHROPIC_API_KEY_KEYCHAIN_ACCOUNT,
      },
      // The setup wizard writes here directly; the legacy
      // ALIEN_SECRETS_FROM_KEYCHAIN gate would block first-run users.
      keychainGate: "always",
    });
  if (!apiKey) {
    throw new Error(
      "createAnthropicLlmClient: ANTHROPIC_API_KEY is required. Open the setup wizard at /setup, set ANTHROPIC_API_KEY in the env, or pass options.apiKey.",
    );
  }
  const client = new Anthropic({ apiKey });
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
