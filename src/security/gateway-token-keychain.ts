import {
  detectKeychainBackend,
  deleteKeychainSecret,
  getKeychainSecret,
  type KeychainAvailability,
  type OsKeychainOptions,
  setKeychainSecret,
} from "./os-keychain.js";

/**
 * Audit M2 (gateway-token slice): operator-facing helpers for storing the
 * gateway bearer token in the OS keychain instead of `~/.alien/alien.json`.
 * Today the token lives in the config file at mode 0o600, which is correct
 * file mode but still readable by any same-uid process (a backup tool, sync
 * agent, misbehaving package).
 *
 * **Scope of this commit:** these helpers + a minimal startup-auth opt-in.
 * Full migration of channel tokens, OAuth credentials, and provider keys to
 * the keychain remains follow-up work.
 *
 * The service identifier is `"alien-gateway"` and the account is
 * `"token"`, so operators can also see/manage the value with:
 *   - macOS: Keychain Access app, search "alien-gateway"
 *   - macOS CLI: `security find-generic-password -s alien-gateway -a token -w`
 *   - Linux: `secret-tool lookup service alien-gateway account token`
 */

export const GATEWAY_TOKEN_SERVICE = "alien-gateway";
export const GATEWAY_TOKEN_ACCOUNT = "token";

export type GatewayTokenKeychainPolicy = "off" | "preferred";

/**
 * Resolves the policy from the `ALIEN_GATEWAY_TOKEN_KEYCHAIN` env var.
 *  - `"1"` → `"preferred"` (read keychain at startup; write on generation)
 *  - anything else → `"off"`
 */
export function resolveGatewayTokenKeychainPolicy(
  env: NodeJS.ProcessEnv,
): GatewayTokenKeychainPolicy {
  return env.ALIEN_GATEWAY_TOKEN_KEYCHAIN === "1" ? "preferred" : "off";
}

export function isGatewayTokenKeychainAvailable(
  options: OsKeychainOptions = {},
): KeychainAvailability {
  return detectKeychainBackend(options);
}

/**
 * Returns the gateway token from the keychain, or `null` when keychain is
 * unavailable / the entry is not present. Never throws on missing entries
 * (so the startup-auth path can fall back to the existing config / env
 * sources without a try/catch).
 */
export function loadGatewayTokenFromKeychain(options: OsKeychainOptions = {}): string | null {
  const value = getKeychainSecret(
    { service: GATEWAY_TOKEN_SERVICE, account: GATEWAY_TOKEN_ACCOUNT },
    options,
  );
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

/**
 * Stores the gateway token in the keychain. Throws when the keychain backend
 * fails — callers that want a soft attempt should wrap in try/catch.
 */
export function saveGatewayTokenToKeychain(token: string, options: OsKeychainOptions = {}): void {
  if (!token || typeof token !== "string") {
    throw new Error("saveGatewayTokenToKeychain: token must be a non-empty string");
  }
  setKeychainSecret(
    { service: GATEWAY_TOKEN_SERVICE, account: GATEWAY_TOKEN_ACCOUNT },
    token,
    options,
  );
}

/**
 * Removes the gateway token from the keychain. Returns whether deletion
 * succeeded (false on unavailable backend or missing entry).
 */
export function clearGatewayTokenFromKeychain(options: OsKeychainOptions = {}): boolean {
  return deleteKeychainSecret(
    { service: GATEWAY_TOKEN_SERVICE, account: GATEWAY_TOKEN_ACCOUNT },
    options,
  );
}
