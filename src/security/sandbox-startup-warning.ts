import type { AlienConfig } from "../config/types.alien.js";

/**
 * Audit H1: surface a clear warning at startup when the agent's main session
 * is running without a sandbox. Upstream's default is `agents.defaults.sandbox.mode = "off"`,
 * which gives main-session tool calls (bash, fs_write, network, browser) full
 * host access. A successful prompt-injection inside that session is then
 * arbitrary code execution as the user.
 *
 * This helper does not flip the default — flipping requires Docker Desktop on
 * every operator's machine, which is a UX call. Instead, we make the unsafe
 * state visible at the moment the operator boots the gateway, and document
 * the opt-in `ALIEN_HARDENED_DEFAULTS=1` env var that flips the default for
 * an individual run.
 *
 * Returns `null` when no warning is needed.
 */
export function resolveSandboxStartupWarning(params: {
  cfg?: AlienConfig;
  env?: NodeJS.ProcessEnv;
}): string | null {
  const env = params.env ?? process.env;
  const explicitMode = params.cfg?.agents?.defaults?.sandbox?.mode;

  // Operator explicitly set a non-off mode → safe.
  // mode = "non-main" sandboxes everything except the main session;
  // mode = "all" sandboxes every session including main.
  if (explicitMode === "non-main" || explicitMode === "all") {
    return null;
  }

  // ALIEN_HARDENED_DEFAULTS=1 flips the unset default to "all", so every
  // session is sandboxed even though the config doesn't say so. No warning.
  if (env.ALIEN_HARDENED_DEFAULTS === "1" && !explicitMode) {
    return null;
  }

  // Otherwise: mode is "off" (explicit or by default) and the operator has
  // not opted into hardened defaults.
  return [
    "Sandbox is OFF for the main session.",
    "  agents.defaults.sandbox.mode is " +
      (explicitMode === "off" ? '"off" (explicit)' : "unset (default → off)") +
      ". Tool calls (bash, fs_write, browser, network) run with your full host privileges.",
    "  Any successful prompt-injection inside the main session = arbitrary code execution as you.",
    "  To harden:",
    '    - Run: ALIEN_HARDENED_DEFAULTS=1 alien gateway run    (per-run opt-in to mode="all")',
    '    - Or set agents.defaults.sandbox.mode: "all" in your alien.json (persistent;',
    '      backend defaults to "docker" — requires Docker Desktop running).',
    "  Audit reference: AUDIT.md H1.",
  ].join("\n");
}
