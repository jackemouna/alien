import { readSecretFromEnvOrKeychain } from "../../security/secret-source.js";
import type { GmailOAuthClientConfig } from "./types.js";

/**
 * Resolves the Gmail OAuth client config for the host process. Users register
 * their own Google Cloud OAuth client (Alien is self-hosted; we deliberately
 * do not ship Alien-owned credentials so the user always controls the OAuth
 * app surface and Google attribution).
 *
 * Lookup order for each credential:
 *   1. The literal env var (GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET).
 *   2. The OS keychain at `alien.ai/gmail-oauth-client-id` and
 *      `alien.ai/gmail-oauth-client-secret`, when
 *      ALIEN_SECRETS_FROM_KEYCHAIN=1.
 *
 * Returns null when either credential is missing — callers should surface a
 * "run `alien gmail connect` setup wizard" message instead of throwing.
 */

export const GMAIL_OAUTH_KEYCHAIN_SERVICE = "alien.ai";
export const GMAIL_OAUTH_CLIENT_ID_ACCOUNT = "gmail-oauth-client-id";
export const GMAIL_OAUTH_CLIENT_SECRET_ACCOUNT = "gmail-oauth-client-secret";

const DEFAULT_REDIRECT_URI = "http://localhost:8086/oauth2callback";

export function resolveGmailOAuthClientConfig(
  env?: NodeJS.ProcessEnv,
): GmailOAuthClientConfig | null {
  const clientId = readSecretFromEnvOrKeychain({
    envVarName: "GMAIL_OAUTH_CLIENT_ID",
    keychain: {
      service: GMAIL_OAUTH_KEYCHAIN_SERVICE,
      account: GMAIL_OAUTH_CLIENT_ID_ACCOUNT,
    },
    ...(env ? { env } : {}),
  });
  const clientSecret = readSecretFromEnvOrKeychain({
    envVarName: "GMAIL_OAUTH_CLIENT_SECRET",
    keychain: {
      service: GMAIL_OAUTH_KEYCHAIN_SERVICE,
      account: GMAIL_OAUTH_CLIENT_SECRET_ACCOUNT,
    },
    ...(env ? { env } : {}),
  });
  if (!clientId || !clientSecret) {
    return null;
  }
  const redirectUri = (env ?? process.env).GMAIL_OAUTH_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;
  return { clientId, clientSecret, redirectUri };
}
