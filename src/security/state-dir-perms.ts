import fs from "node:fs";
import path from "node:path";

/**
 * Audit M5: at startup, surface a warning when `~/.alien/` (or whichever
 * directory holds Alien's state) is more permissive than 0o700.
 *
 * The code that *creates* `~/.alien/` already passes `mode: 0o700`, but the
 * directory may pre-exist with looser perms — created by an earlier umask, a
 * `chmod` from the operator, or migrated from a prior install. Once it exists,
 * nothing in the code re-tightens it. Loose perms make every secret under
 * `credentials/` and `agents/<id>/agent/auth-profiles.json` readable to any
 * same-uid (or world) reader.
 *
 * Returns `null` when the directory doesn't exist (fresh install) or is at
 * the expected `0o700`. Returns a multi-line warning otherwise.
 */
export type StateDirPermsCheckOptions = {
  /** Absolute path to Alien's state directory (typically `~/.alien`). */
  readonly stateDir: string;
  /** Override hook for `fs.statSync` to make the helper testable. */
  readonly statSync?: (target: string) => fs.Stats;
  /** Override hook for `process.platform` to test platform-skip behavior. */
  readonly platform?: NodeJS.Platform;
};

export function resolveStateDirPermsWarning(options: StateDirPermsCheckOptions): string | null {
  const platform = options.platform ?? process.platform;
  // Windows mode bits do not map to POSIX rwx — skip the check there.
  if (platform === "win32") {
    return null;
  }
  const statSync = options.statSync ?? ((p: string) => fs.statSync(p));

  let stat: fs.Stats;
  try {
    stat = statSync(options.stateDir);
  } catch {
    return null;
  }

  if (!stat.isDirectory()) {
    return null;
  }

  const mode = stat.mode & 0o777;
  if (mode === 0o700) {
    return null;
  }
  if ((mode & 0o077) === 0) {
    // Owner-only access (e.g. 0o600 or 0o500) — slightly off but not exposing secrets.
    return null;
  }

  const dirLabel = path.resolve(options.stateDir);
  const groupReadable = (mode & 0o050) !== 0;
  const worldReadable = (mode & 0o005) !== 0;
  const worldWritable = (mode & 0o002) !== 0;

  const exposures: string[] = [];
  if (worldWritable) {
    exposures.push("world-writable");
  } else if (worldReadable) {
    exposures.push("world-readable");
  }
  if (groupReadable) {
    exposures.push("group-readable");
  }

  return [
    `State directory ${dirLabel} has loose permissions (${describeMode(mode)}; ${exposures.join(", ") || "non-0o700"}).`,
    "  This directory holds plaintext channel tokens, OAuth refresh tokens, and provider API keys.",
    "  Any other process or user with read access can exfiltrate them.",
    "  Fix: chmod 700 " + dirLabel,
    "  Audit reference: AUDIT.md M5.",
  ].join("\n");
}

function describeMode(mode: number): string {
  return `0o${mode.toString(8).padStart(3, "0")}`;
}
