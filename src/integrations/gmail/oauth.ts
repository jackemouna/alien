import { GMAIL_OAUTH_SCOPES, type GmailOAuthClientConfig, type GmailTokens } from "./types.js";

/**
 * Gmail OAuth helpers — pure functions plus a thin fetch wrapper. The
 * interactive callback loop lives in the CLI (`alien gmail connect`),
 * not here, so this module stays trivially testable.
 *
 * Flow:
 *   1. buildAuthUrl(state)  → operator opens URL in browser, grants access.
 *   2. Google redirects to redirectUri?code=XXX&state=YYY (CLI handles).
 *   3. exchangeCodeForTokens(code) → access + refresh tokens.
 *   4. tokens stored in OS keychain (src/integrations/gmail/tokens.ts).
 *   5. refreshAccessToken(refreshToken) when the access token expires.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export type BuildAuthUrlParams = {
  readonly config: GmailOAuthClientConfig;
  readonly state: string;
  /**
   * Optional Google account hint so the consent screen pre-selects an
   * account when the user has multiple signed in.
   */
  readonly loginHint?: string;
  /**
   * Override the granted scope set. Defaults to GMAIL_OAUTH_SCOPES. Smaller
   * scope sets are useful for tests; production callers should leave this
   * undefined so the requested scope matches the documented contract.
   */
  readonly scopes?: readonly string[];
};

export function buildAuthUrl(params: BuildAuthUrlParams): string {
  const scopes = params.scopes ?? GMAIL_OAUTH_SCOPES;
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", params.config.clientId);
  url.searchParams.set("redirect_uri", params.config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("access_type", "offline"); // we need a refresh_token
  url.searchParams.set("prompt", "consent"); // force consent to ensure refresh_token
  url.searchParams.set("state", params.state);
  if (params.loginHint) {
    url.searchParams.set("login_hint", params.loginHint);
  }
  return url.toString();
}

export type ExchangeCodeForTokensParams = {
  readonly config: GmailOAuthClientConfig;
  readonly code: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
};

export async function exchangeCodeForTokens(
  params: ExchangeCodeForTokensParams,
): Promise<GmailTokens> {
  const fetchFn = params.fetchImpl ?? fetch;
  const now = params.now ?? Date.now;
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.config.clientId,
    client_secret: params.config.clientSecret,
    redirect_uri: params.config.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw await tokenError(res, "exchange");
  }
  const json = (await res.json()) as RawTokenResponse;
  if (!json.refresh_token) {
    throw new Error(
      "Gmail OAuth: Google did not return a refresh_token. Re-run with the consent prompt enabled.",
    );
  }
  return materializeTokens(json, now);
}

export type RefreshAccessTokenParams = {
  readonly config: GmailOAuthClientConfig;
  readonly refreshToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
};

export async function refreshAccessToken(params: RefreshAccessTokenParams): Promise<GmailTokens> {
  const fetchFn = params.fetchImpl ?? fetch;
  const now = params.now ?? Date.now;
  const body = new URLSearchParams({
    client_id: params.config.clientId,
    client_secret: params.config.clientSecret,
    refresh_token: params.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw await tokenError(res, "refresh");
  }
  const json = (await res.json()) as RawTokenResponse;
  // Google does NOT return a new refresh_token on refresh; preserve the old one.
  const next: RawTokenResponse = {
    ...json,
    refresh_token: json.refresh_token ?? params.refreshToken,
  };
  return materializeTokens(next, now);
}

export type RevokeTokenParams = {
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
};

export async function revokeToken(params: RevokeTokenParams): Promise<void> {
  const fetchFn = params.fetchImpl ?? fetch;
  const url = new URL("https://oauth2.googleapis.com/revoke");
  url.searchParams.set("token", params.token);
  const res = await fetchFn(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) {
    throw await tokenError(res, "revoke");
  }
}

type RawTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

function materializeTokens(raw: RawTokenResponse, now: () => number): GmailTokens {
  if (!raw.access_token) {
    throw new Error("Gmail OAuth: token response missing access_token");
  }
  if (!raw.refresh_token) {
    throw new Error("Gmail OAuth: token response missing refresh_token");
  }
  const expiresInMs = (raw.expires_in ?? 3600) * 1000;
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: now() + expiresInMs,
    scopes: typeof raw.scope === "string" ? raw.scope.split(/\s+/).filter(Boolean) : [],
  };
}

async function tokenError(res: Response, op: string): Promise<Error> {
  let detail: string;
  try {
    const body = (await res.json()) as { error?: string; error_description?: string };
    detail = body.error_description ?? body.error ?? `HTTP ${res.status}`;
  } catch {
    detail = `HTTP ${res.status}`;
  }
  return new Error(`Gmail OAuth ${op} failed: ${detail}`);
}
