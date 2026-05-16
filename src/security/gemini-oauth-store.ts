import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

/**
 * Local persistence for Google Gemini OAuth credentials (the Gemini CLI
 * OAuth flow). Mirrors openai-oauth-store / anthropic-oauth-store.
 *
 * Format: `${state-dir}/gemini-oauth.json`, mode 0600.
 *
 * Carries `email` + `projectId` from the Gemini CLI OAuth so the
 * runtime can use the right Google Cloud project for billing.
 */

export type GeminiOAuthCredentials = {
  readonly access: string;
  readonly refresh: string;
  /** Unix-ms when the access token expires. */
  readonly expires: number;
  readonly email?: string;
  readonly projectId?: string;
};

const FILE_NAME = "gemini-oauth.json";

export function resolveGeminiOAuthPath(): string {
  return path.join(resolveStateDir(), FILE_NAME);
}

export async function readGeminiOAuth(): Promise<GeminiOAuthCredentials | null> {
  try {
    const raw = await fs.readFile(resolveGeminiOAuthPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isCredentials(parsed)) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeGeminiOAuth(creds: GeminiOAuthCredentials): Promise<void> {
  const filePath = resolveGeminiOAuthPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload: GeminiOAuthCredentials = {
    access: creds.access,
    refresh: creds.refresh,
    expires: creds.expires,
    ...(creds.email ? { email: creds.email } : {}),
    ...(creds.projectId ? { projectId: creds.projectId } : {}),
  };
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(filePath, 0o600).catch(() => {});
}

export async function clearGeminiOAuth(): Promise<void> {
  try {
    await fs.unlink(resolveGeminiOAuthPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

function isCredentials(value: unknown): value is GeminiOAuthCredentials {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.access === "string" && typeof v.refresh === "string" && typeof v.expires === "number"
  );
}
