import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

/**
 * Local persistence for Anthropic OAuth credentials (Claude Pro/Max
 * subscription auth), separate from the full `auth-profiles.json`
 * system. The wizard writes here; the LLM client reads here and refreshes
 * when the access token is about to expire.
 *
 * Format: `${state-dir}/anthropic-oauth.json`, mode 0600.
 *
 * Anything richer (account email, multiple accounts, per-agent routing) is
 * deliberately out of scope here — that's the auth-profiles system's job.
 * This file is a single-tenant convenience for the first-run wizard.
 */

export type AnthropicOAuthCredentials = {
  readonly access: string;
  readonly refresh: string;
  /** Unix-ms when the access token expires. */
  readonly expires: number;
};

const FILE_NAME = "anthropic-oauth.json";

export function resolveAnthropicOAuthPath(): string {
  return path.join(resolveStateDir(), FILE_NAME);
}

export async function readAnthropicOAuth(): Promise<AnthropicOAuthCredentials | null> {
  try {
    const raw = await fs.readFile(resolveAnthropicOAuthPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isCredentials(parsed)) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeAnthropicOAuth(creds: AnthropicOAuthCredentials): Promise<void> {
  const filePath = resolveAnthropicOAuthPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload: AnthropicOAuthCredentials = {
    access: creds.access,
    refresh: creds.refresh,
    expires: creds.expires,
  };
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(filePath, 0o600).catch(() => {
    // chmod failures are non-fatal (some filesystems ignore unix perms).
  });
}

export async function clearAnthropicOAuth(): Promise<void> {
  try {
    await fs.unlink(resolveAnthropicOAuthPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

function isCredentials(value: unknown): value is AnthropicOAuthCredentials {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.access === "string" && typeof v.refresh === "string" && typeof v.expires === "number"
  );
}

const REFRESH_SLACK_MS = 60_000; // refresh 60s before actual expiry

export function shouldRefresh(creds: AnthropicOAuthCredentials, now: number = Date.now()): boolean {
  return creds.expires - REFRESH_SLACK_MS <= now;
}
