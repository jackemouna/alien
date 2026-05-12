import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { resolveStateDir } from "../config/paths.js";
import { resolveGmailOAuthClientConfig } from "../integrations/gmail/config.js";
import { detectKeychainBackend } from "../security/os-keychain.js";
import { readSecretFromEnvOrKeychain } from "../security/secret-source.js";
import { loadStarterTemplates } from "../templates/loader.js";

/**
 * `alien init` — friendly setup-status check. Tells the user in plain
 * English what's already configured and what they need to do next.
 *
 * This is *not* a full interactive wizard (the OAuth flows live in their
 * own subcommands like `alien gmail connect`). It's the one-line answer
 * to "I just installed this thing — what now?".
 */

type CheckOutcome = {
  readonly label: string;
  readonly ok: boolean;
  /** Plain-English next-step hint when !ok. */
  readonly hint?: string;
};

export function registerInitCli(program: Command): void {
  program
    .command("init")
    .description("Check what's set up and tell you what to do next")
    .action(async () => {
      const stateDir = resolveStateDir(process.env);
      const checks: CheckOutcome[] = [
        await checkAnthropicKey(),
        checkStateDir(stateDir),
        checkKeychain(),
        checkHardenedDefaults(),
        checkGmailCredentials(),
        checkGmailDefaultAccount(),
        checkTemplates(),
      ];

      printIntro();
      for (const check of checks) {
        printCheck(check);
      }
      printNextStep(checks);
    });
}

function printIntro(): void {
  process.stdout.write(
    ["", "👾 Alien setup check", "", "Here's how your install looks right now:", ""].join("\n"),
  );
}

function printCheck(check: CheckOutcome): void {
  const mark = check.ok ? "✓" : "·";
  process.stdout.write(`  ${mark}  ${check.label}\n`);
  if (!check.ok && check.hint) {
    process.stdout.write(`        ${check.hint}\n`);
  }
}

function printNextStep(checks: readonly CheckOutcome[]): void {
  const firstMissing = checks.find((c) => !c.ok);
  process.stdout.write("\n");
  if (!firstMissing) {
    process.stdout.write(
      [
        "You're all set. Start the gateway, open the Projects tab, and tell",
        "your team what to do.",
        "",
      ].join("\n"),
    );
    return;
  }
  process.stdout.write(
    [
      "What's next:",
      `  → ${firstMissing.hint ?? firstMissing.label}`,
      "",
      "Run `alien init` again any time you want to re-check.",
      "",
    ].join("\n"),
  );
}

// --- individual checks --------------------------------------------------------

async function checkAnthropicKey(): Promise<CheckOutcome> {
  const value = readSecretFromEnvOrKeychain({
    envVarName: "ANTHROPIC_API_KEY",
    keychain: { service: "alien.ai", account: "anthropic-api-key" },
  });
  if (value) {
    return { label: "Anthropic API key configured", ok: true };
  }
  return {
    label: "Anthropic API key not set",
    ok: false,
    hint:
      "Get a key at https://console.anthropic.com/keys, then set ANTHROPIC_API_KEY " +
      "in your shell (or store it in the OS keychain and run with ALIEN_SECRETS_FROM_KEYCHAIN=1).",
  };
}

function checkStateDir(stateDir: string): CheckOutcome {
  const exists = fs.existsSync(stateDir);
  if (!exists) {
    return {
      label: `State directory ${stateDir}`,
      ok: false,
      hint: "Will be created on first gateway start. No action needed.",
    };
  }
  try {
    const stat = fs.statSync(stateDir);
    const mode = stat.mode & 0o777;
    if (mode !== 0o700) {
      return {
        label: `State directory ${stateDir} (permissions ${mode.toString(8)})`,
        ok: false,
        hint:
          "Expected permissions 700 so only your user can read it. " +
          `Fix with: chmod 700 ${stateDir}`,
      };
    }
  } catch {
    /* fall through to ok=true with a soft note */
  }
  return { label: `State directory ${stateDir} (permissions 700)`, ok: true };
}

function checkKeychain(): CheckOutcome {
  const availability = detectKeychainBackend();
  if (availability.available) {
    return {
      label: `OS keychain available (${availability.backend})`,
      ok: true,
    };
  }
  return {
    label: "OS keychain unavailable",
    ok: false,
    hint:
      availability.reason ??
      "Alien will fall back to env-var secrets. The keychain is preferred for production use.",
  };
}

function checkHardenedDefaults(): CheckOutcome {
  if (process.env.ALIEN_HARDENED_DEFAULTS === "1") {
    return { label: "Hardened defaults enabled (ALIEN_HARDENED_DEFAULTS=1)", ok: true };
  }
  return {
    label: "Hardened defaults not enabled",
    ok: false,
    hint:
      "Set ALIEN_HARDENED_DEFAULTS=1 to enable the sandbox-by-default profile. " +
      "Recommended for any deployment beyond local exploration.",
  };
}

function checkGmailCredentials(): CheckOutcome {
  const cfg = resolveGmailOAuthClientConfig();
  if (cfg) {
    return { label: "Gmail OAuth client credentials configured", ok: true };
  }
  return {
    label: "Gmail not configured (optional)",
    ok: false,
    hint:
      "Skip if you don't need email. Otherwise: create a Google OAuth client at " +
      "https://console.cloud.google.com/apis/credentials, set GMAIL_OAUTH_CLIENT_ID + " +
      "GMAIL_OAUTH_CLIENT_SECRET, then run `alien gmail connect <your-address@gmail.com>`.",
  };
}

function checkGmailDefaultAccount(): CheckOutcome {
  const cfg = resolveGmailOAuthClientConfig();
  if (!cfg) {
    return {
      label: "Gmail default account skipped (Gmail not configured)",
      ok: true,
    };
  }
  if ((process.env.GMAIL_DEFAULT_ACCOUNT ?? "").trim()) {
    return {
      label: `Gmail default account: ${process.env.GMAIL_DEFAULT_ACCOUNT}`,
      ok: true,
    };
  }
  return {
    label: "Gmail default account not set",
    ok: false,
    hint:
      "Run `alien gmail connect <your-address@gmail.com>` and then set " +
      "GMAIL_DEFAULT_ACCOUNT=<your-address@gmail.com> so the worker knows which inbox to use.",
  };
}

function checkTemplates(): CheckOutcome {
  const templates = loadStarterTemplates();
  if (templates.length === 0) {
    return {
      label: "Starter templates not found",
      ok: false,
      hint:
        `Expected JSON files in ${path.join(process.cwd(), "templates")}. ` +
        "If you cloned the repo, this should already be populated.",
    };
  }
  return {
    label: `${templates.length} starter templates loaded`,
    ok: true,
  };
}
