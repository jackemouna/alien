import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

/**
 * Local persistence for OpenAI Codex / ChatGPT OAuth credentials, the
 * subscription-billed equivalent of pasting an API key. Same shape +
 * lifecycle as anthropic-oauth-store.ts.
 *
 * Format: `${state-dir}/openai-oauth.json`, mode 0600.
 */

export type OpenAIOAuthCredentials = {
  readonly access: string;
  readonly refresh: string;
  /** Unix-ms when the access token expires. */
  readonly expires: number;
};

const FILE_NAME = "openai-oauth.json";

export function resolveOpenAIOAuthPath(): string {
  return path.join(resolveStateDir(), FILE_NAME);
}

export async function readOpenAIOAuth(): Promise<OpenAIOAuthCredentials | null> {
  try {
    const raw = await fs.readFile(resolveOpenAIOAuthPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isCredentials(parsed)) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeOpenAIOAuth(creds: OpenAIOAuthCredentials): Promise<void> {
  const filePath = resolveOpenAIOAuthPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload: OpenAIOAuthCredentials = {
    access: creds.access,
    refresh: creds.refresh,
    expires: creds.expires,
  };
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(filePath, 0o600).catch(() => {});
}

export async function clearOpenAIOAuth(): Promise<void> {
  try {
    await fs.unlink(resolveOpenAIOAuthPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

function isCredentials(value: unknown): value is OpenAIOAuthCredentials {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.access === "string" && typeof v.refresh === "string" && typeof v.expires === "number"
  );
}

const REFRESH_SLACK_MS = 60_000;

export function shouldRefresh(creds: OpenAIOAuthCredentials, now: number = Date.now()): boolean {
  return creds.expires - REFRESH_SLACK_MS <= now;
}
