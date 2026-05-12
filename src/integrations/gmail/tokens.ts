import {
  deleteKeychainSecret,
  detectKeychainBackend,
  getKeychainSecret,
  setKeychainSecret,
  type OsKeychainOptions,
} from "../../security/os-keychain.js";
import type { GmailTokens } from "./types.js";

/**
 * Persists Gmail OAuth tokens in the OS keychain, never in plaintext on
 * disk. One keychain entry per `email` (so a user can connect multiple
 * Gmail accounts side-by-side).
 *
 * Keychain layout:
 *   service: "alien.ai/gmail"
 *   account: "<email>"
 *   secret:  JSON.stringify({accessToken, refreshToken, expiresAt, scopes})
 *
 * The keychain backend is detected at call time (macOS Keychain on darwin,
 * libsecret on linux). If unavailable, the helpers throw — Gmail tokens
 * should not fall through to plaintext storage.
 */

export const GMAIL_KEYCHAIN_SERVICE = "alien.ai/gmail";

export type StoreGmailTokensParams = {
  readonly email: string;
  readonly tokens: GmailTokens;
  readonly keychainOptions?: OsKeychainOptions;
};

export function storeGmailTokens(params: StoreGmailTokensParams): void {
  setKeychainSecret(
    { service: GMAIL_KEYCHAIN_SERVICE, account: normalizeAccount(params.email) },
    serializeTokens(params.tokens),
    params.keychainOptions ?? {},
  );
}

export type GetGmailTokensParams = {
  readonly email: string;
  readonly keychainOptions?: OsKeychainOptions;
};

export function getGmailTokens(params: GetGmailTokensParams): GmailTokens | null {
  const availability = detectKeychainBackend(params.keychainOptions ?? {});
  if (!availability.available) return null;
  const raw = getKeychainSecret(
    { service: GMAIL_KEYCHAIN_SERVICE, account: normalizeAccount(params.email) },
    params.keychainOptions ?? {},
  );
  if (!raw) return null;
  return deserializeTokens(raw);
}

export function deleteGmailTokens(params: GetGmailTokensParams): boolean {
  const availability = detectKeychainBackend(params.keychainOptions ?? {});
  if (!availability.available) return false;
  return deleteKeychainSecret(
    { service: GMAIL_KEYCHAIN_SERVICE, account: normalizeAccount(params.email) },
    params.keychainOptions ?? {},
  );
}

function serializeTokens(tokens: GmailTokens): string {
  return JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scopes: [...tokens.scopes],
  });
}

function deserializeTokens(raw: string): GmailTokens | null {
  try {
    const parsed = JSON.parse(raw) as Partial<GmailTokens> & {
      scopes?: unknown;
    };
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    const scopes = Array.isArray(parsed.scopes)
      ? parsed.scopes.filter((s): s is string => typeof s === "string")
      : [];
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      scopes,
    };
  } catch {
    return null;
  }
}

function normalizeAccount(email: string): string {
  // Keychain account is opaque to us, but pre-trim + lowercase so two
  // entries for the same address don't end up in different keychain slots.
  return email.trim().toLowerCase();
}
