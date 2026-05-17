import fs from "node:fs";
import path from "node:path";
import { logInfo, logWarn } from "../logger.js";
import { readGeminiOAuth } from "./gemini-oauth-store.js";

/**
 * Bootstrap the Gemini CLI so the agent runtime's CLI backend can use
 * it via OAuth Code Assist without any operator-side env wrangling.
 *
 * Idempotent. Safe to call multiple times — it only writes when the
 * existing files would change.
 *
 * Three side effects when gemini-oauth.json is present:
 *   1. process.env gets GOOGLE_GENAI_USE_GCA=true,
 *      GOOGLE_CLOUD_PROJECT=<projectId from oauth file>, and
 *      GEMINI_CLI_TRUST_WORKSPACE=true so child gemini CLI spawns
 *      pick them up.
 *   2. ~/.gemini/settings.json gets selectedAuthType=oauth-personal
 *      so the CLI doesn't prompt for an auth method.
 *   3. ~/.gemini/oauth_creds.json gets a copy of the access/refresh
 *      tokens translated into the google-auth-library shape the CLI
 *      expects ({access_token, refresh_token, scope, token_type,
 *      expiry_date}).
 *
 * Why this isn't behind a flag: if you have a Gemini OAuth file, you
 * already signed in for this purpose. Skipping the bootstrap means the
 * agent fails with "Please set an Auth method" which is much worse UX.
 */

const SCOPE =
  "https://www.googleapis.com/auth/cloud-platform " +
  "https://www.googleapis.com/auth/userinfo.email " +
  "https://www.googleapis.com/auth/userinfo.profile";

export async function bootstrapGeminiCliEnv(): Promise<void> {
  const creds = await readGeminiOAuth();
  if (!creds) {
    logInfo("gemini-cli-bootstrap: no oauth file — skipping (sign in on /integrations to enable)");
    return;
  }

  // 1. Env vars (process-level — child spawns inherit)
  if (!process.env.GOOGLE_GENAI_USE_GCA) process.env.GOOGLE_GENAI_USE_GCA = "true";
  if (creds.projectId && !process.env.GOOGLE_CLOUD_PROJECT) {
    process.env.GOOGLE_CLOUD_PROJECT = creds.projectId;
  }
  if (!process.env.GEMINI_CLI_TRUST_WORKSPACE) {
    process.env.GEMINI_CLI_TRUST_WORKSPACE = "true";
  }
  logInfo(`gemini-cli-bootstrap: GCA env set (project=${process.env.GOOGLE_CLOUD_PROJECT ?? "?"})`);

  const home = process.env.HOME ?? "";
  if (!home) return;
  const dir = path.join(home, ".gemini");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    logWarn(
      `gemini-cli-bootstrap: mkdir ${dir} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // 2. settings.json — selectedAuthType
  const settingsPath = path.join(dir, "settings.json");
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    // missing or malformed; we'll rewrite
  }
  if (settings.selectedAuthType !== "oauth-personal") {
    settings.selectedAuthType = "oauth-personal";
    try {
      fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
      logInfo(`gemini-cli-bootstrap: wrote ${settingsPath} (selectedAuthType=oauth-personal)`);
    } catch (err) {
      logWarn(
        `gemini-cli-bootstrap: writing ${settingsPath} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 3. oauth_creds.json — token shape the CLI expects
  const credsPath = path.join(dir, "oauth_creds.json");
  const desired = {
    access_token: creds.access,
    refresh_token: creds.refresh,
    scope: SCOPE,
    token_type: "Bearer",
    expiry_date: creds.expires,
  };
  let current: { access_token?: string; expiry_date?: number } = {};
  try {
    current = JSON.parse(fs.readFileSync(credsPath, "utf8")) as typeof current;
  } catch {
    // missing or malformed; we'll write
  }
  if (
    current.access_token !== desired.access_token ||
    current.expiry_date !== desired.expiry_date
  ) {
    try {
      fs.writeFileSync(credsPath, `${JSON.stringify(desired, null, 2)}\n`, { mode: 0o600 });
      logInfo(`gemini-cli-bootstrap: refreshed ${credsPath}`);
    } catch (err) {
      logWarn(
        `gemini-cli-bootstrap: writing ${credsPath} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
