import {
  detectKeychainBackend,
  getKeychainSecret,
  type KeychainSecretRef,
  type OsKeychainOptions,
} from "./os-keychain.js";

/**
 * Audit M2 (broader migration slice): a unified resolver that reads a secret
 * from the process env first and, if absent, falls back to the OS keychain.
 *
 * This is the building block bundled provider/channel paths can adopt to
 * migrate any single secret out of plaintext `.env` files into the keychain
 * without restructuring auth-resolution surfaces. Each consumer decides:
 *
 *   - the env-var name (e.g. `OPENAI_API_KEY`, `SLACK_BOT_TOKEN`, …);
 *   - the keychain `service` and `account` identifiers;
 *   - whether the keychain fallback is gated by a global opt-in flag
 *     (`ALIEN_SECRETS_FROM_KEYCHAIN=1`) or always-on for that secret.
 *
 * A separate per-secret wrapper (e.g. `gateway-token-keychain.ts`) is the
 * usual layer where consumers pick those defaults.
 */

export const SECRETS_FROM_KEYCHAIN_ENV = "ALIEN_SECRETS_FROM_KEYCHAIN";

export type ResolveSecretParams = {
  /** Env-var name to consult first. */
  readonly envVarName: string;
  /** Keychain service/account to fall back to when env is empty. */
  readonly keychain: KeychainSecretRef;
  /** Process env to read. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * - `"always"` — try keychain regardless of `ALIEN_SECRETS_FROM_KEYCHAIN`.
   *   Use this for per-secret wrappers that have their own opt-in flag.
   * - `"global-flag"` (default) — try keychain only when the global env flag
   *   `ALIEN_SECRETS_FROM_KEYCHAIN=1` is set.
   */
  readonly keychainGate?: "always" | "global-flag";
  /** Hooks for testing the keychain backend. Forwards to os-keychain. */
  readonly keychainOptions?: OsKeychainOptions;
};

export type SecretResolution =
  | { readonly source: "env"; readonly value: string }
  | { readonly source: "keychain"; readonly value: string }
  | { readonly source: "missing" };

/**
 * Resolves a secret from env first, then keychain. Returns a tagged result
 * so callers can log or warn based on which source supplied the value (e.g.
 * to nudge operators to migrate plaintext-env secrets to the keychain).
 */
export function resolveSecretFromEnvOrKeychain(params: ResolveSecretParams): SecretResolution {
  const env = params.env ?? process.env;
  const fromEnv = env[params.envVarName];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return { source: "env", value: fromEnv };
  }
  const gate = params.keychainGate ?? "global-flag";
  if (gate === "global-flag" && env[SECRETS_FROM_KEYCHAIN_ENV] !== "1") {
    return { source: "missing" };
  }
  const availability = detectKeychainBackend(params.keychainOptions);
  if (!availability.available) {
    return { source: "missing" };
  }
  const fromKeychain = getKeychainSecret(params.keychain, params.keychainOptions);
  if (typeof fromKeychain === "string" && fromKeychain.length > 0) {
    return { source: "keychain", value: fromKeychain };
  }
  return { source: "missing" };
}

/**
 * Convenience wrapper that returns just the value (or undefined) without the
 * source tag, for code paths that only care about the resolved string.
 */
export function readSecretFromEnvOrKeychain(params: ResolveSecretParams): string | undefined {
  const result = resolveSecretFromEnvOrKeychain(params);
  return result.source === "missing" ? undefined : result.value;
}
