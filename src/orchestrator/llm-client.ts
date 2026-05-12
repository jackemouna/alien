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

export type LlmClient = {
  complete(request: LlmCompletionRequest): Promise<string>;
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
    });
  if (!apiKey) {
    throw new Error(
      "createAnthropicLlmClient: ANTHROPIC_API_KEY is required. Set it in the env, store it in the OS keychain (ALIEN_SECRETS_FROM_KEYCHAIN=1, service=alien.ai, account=anthropic-api-key), or pass options.apiKey.",
    );
  }
  const client = new Anthropic({ apiKey });
  const model = options.model ?? DEFAULT_MODEL;
  const defaultMaxTokens = options.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async complete(req: LlmCompletionRequest): Promise<string> {
      const message = await client.messages.create(
        {
          model,
          max_tokens: req.maxTokens ?? defaultMaxTokens,
          ...(req.system ? { system: req.system } : {}),
          messages: [{ role: "user", content: req.user }],
        },
        req.signal ? { signal: req.signal } : undefined,
      );
      return collectTextContent(message.content);
    },
  };
}

/** Test helper: build a stub LlmClient that returns the given response. */
export function createStubLlmClient(
  respond: (request: LlmCompletionRequest) => string | Promise<string>,
): LlmClient {
  return {
    async complete(request: LlmCompletionRequest): Promise<string> {
      return Promise.resolve(respond(request));
    },
  };
}

type AnthropicContentBlock = {
  type: string;
  text?: string;
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
