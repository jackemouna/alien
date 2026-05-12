import {
  generateOAuthState,
  waitForLocalOAuthCallback,
} from "../../plugin-sdk/provider-auth-runtime.js";
import { buildAuthUrl, exchangeCodeForTokens } from "./oauth.js";
import { storeGmailTokens } from "./tokens.js";
import type { GmailOAuthClientConfig, GmailTokens } from "./types.js";

/**
 * `alien gmail connect` flow. Pure-ish; the CLI thin layer opens the
 * browser and prints output. The wallpaper here:
 *
 *   1. Generate a fresh state token.
 *   2. Build the Google authorize URL (consent-forced for refresh_token).
 *   3. Start a localhost server listening for the OAuth redirect.
 *   4. Have the operator open the URL in a browser.
 *   5. Google redirects back with ?code=...&state=...
 *   6. Exchange the code for { access_token, refresh_token }.
 *   7. Persist to the OS keychain under the operator-supplied email.
 *
 * Errors are user-friendly — they tell the operator what to fix.
 */

export type GmailConnectParams = {
  readonly config: GmailOAuthClientConfig;
  readonly email: string;
  /** What to do with the prompted Google authorize URL. CLI prints it; tests inject a no-op. */
  readonly presentAuthUrl: (url: string) => void | Promise<void>;
  readonly onProgress?: (msg: string) => void;
  readonly timeoutMs?: number;
  /** Override for tests; production uses fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Override for tests; production calls waitForLocalOAuthCallback directly. */
  readonly waitForCallback?: typeof waitForLocalOAuthCallback;
  /** Override for tests; production persists to the OS keychain. */
  readonly persistTokens?: (email: string, tokens: GmailTokens) => void;
};

export type GmailConnectResult = {
  readonly tokens: GmailTokens;
};

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export async function connectGmailAccount(params: GmailConnectParams): Promise<GmailConnectResult> {
  if (!params.email.trim()) {
    throw new Error("alien gmail connect: email is required (e.g. you@example.com)");
  }
  const callbackUrl = new URL(params.config.redirectUri);
  if (callbackUrl.hostname !== "localhost" && callbackUrl.hostname !== "127.0.0.1") {
    throw new Error(
      `alien gmail connect: redirectUri must use localhost (got ${callbackUrl.hostname}). ` +
        "The connect flow listens on this machine; remote redirect URIs would not reach us.",
    );
  }
  const port = Number(callbackUrl.port || "80");
  if (!Number.isFinite(port)) {
    throw new Error("alien gmail connect: redirectUri must include a port (e.g. :8086)");
  }
  const state = generateOAuthState();
  const authUrl = buildAuthUrl({
    config: params.config,
    state,
    loginHint: params.email,
  });
  await params.presentAuthUrl(authUrl);

  const wait = params.waitForCallback ?? waitForLocalOAuthCallback;
  const cb = await wait({
    expectedState: state,
    timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    port,
    callbackPath: callbackUrl.pathname || "/oauth2callback",
    redirectUri: params.config.redirectUri,
    successTitle: "Alien is connected to Gmail ✓",
    ...(params.onProgress ? { onProgress: params.onProgress } : {}),
  });

  const tokens = await exchangeCodeForTokens({
    config: params.config,
    code: cb.code,
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
  });

  if (params.persistTokens) {
    params.persistTokens(params.email, tokens);
  } else {
    storeGmailTokens({ email: params.email, tokens });
  }

  return { tokens };
}
