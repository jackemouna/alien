import { spawnSync } from "node:child_process";

/**
 * Reads the Claude Code OAuth session from local storage. When the
 * operator has Claude Code installed and signed in, their OAuth token
 * lives in the OS keychain at `service=Claude Code-credentials`.
 *
 * Using this token (instead of a wizard-OAuth-from-scratch token) makes
 * Anthropic see the requests as coming from Claude Code itself, which
 * is what subscribers actually want — Pro/Max billing applies, not the
 * "third-party app extra usage" pool.
 *
 * macOS only for v0.1. Linux Claude Code session likely lives at
 * `~/.config/claude/credentials.json` or similar; revisit when there's
 * a Linux operator who needs it.
 */

export type ClaudeCodeSession = {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Unix-ms when the access token expires. */
  readonly expiresAt: number;
  readonly scopes?: ReadonlyArray<string>;
  readonly subscriptionType?: string;
  readonly rateLimitTier?: string;
  readonly organizationUuid?: string;
};

type StoredCredentials = {
  claudeAiOauth?: {
    accessToken?: unknown;
    refreshToken?: unknown;
    expiresAt?: unknown;
    scopes?: unknown;
    subscriptionType?: unknown;
    rateLimitTier?: unknown;
  };
  organizationUuid?: unknown;
};

const KEYCHAIN_SERVICE = "Claude Code-credentials";

export function isClaudeCodeSessionAvailable(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const result = spawnSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-g"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function readClaudeCodeSession(): ClaudeCodeSession | null {
  if (process.platform !== "darwin") return null;
  let raw: string;
  try {
    const result = spawnSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0) return null;
    raw = (result.stdout?.toString("utf8") ?? "").trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: StoredCredentials;
  try {
    parsed = JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
  const oauth = parsed.claudeAiOauth;
  if (!oauth || typeof oauth.accessToken !== "string" || typeof oauth.refreshToken !== "string") {
    return null;
  }
  const expiresAt =
    typeof oauth.expiresAt === "number"
      ? oauth.expiresAt
      : typeof oauth.expiresAt === "string"
        ? Number(oauth.expiresAt)
        : 0;
  return {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    ...(Array.isArray(oauth.scopes)
      ? { scopes: oauth.scopes.filter((s): s is string => typeof s === "string") }
      : {}),
    ...(typeof oauth.subscriptionType === "string"
      ? { subscriptionType: oauth.subscriptionType }
      : {}),
    ...(typeof oauth.rateLimitTier === "string" ? { rateLimitTier: oauth.rateLimitTier } : {}),
    ...(typeof parsed.organizationUuid === "string"
      ? { organizationUuid: parsed.organizationUuid }
      : {}),
  };
}

const TOKEN_REFRESH_SLACK_MS = 60_000;

/**
 * True when the session's access token is within 60s of expiring (or
 * already expired). Caller should either refresh or fall back to
 * something else.
 */
export function isClaudeCodeSessionExpiringSoon(
  session: ClaudeCodeSession,
  now: number = Date.now(),
): boolean {
  if (!session.expiresAt) return false;
  return session.expiresAt - TOKEN_REFRESH_SLACK_MS <= now;
}
