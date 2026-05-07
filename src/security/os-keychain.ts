import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";

/**
 * Audit M2: helper for storing/reading secrets via the OS keychain instead of
 * plaintext JSON under `~/.alien/credentials/`. The on-disk files are mode
 * 0o600 (correct), but a backup tool, sync agent, or any same-uid process
 * still reads them. The OS keychain (macOS Keychain, Linux libsecret) gates
 * access on the user's login session and refuses unrelated processes.
 *
 * **Scope of this commit:** the helper is a building block. Migrating the
 * existing secret paths (`src/secrets/shared.ts`, channel/provider auth
 * profiles) to use it is deliberate follow-up work — it changes how every
 * secret is stored and needs careful migration handling for operators with
 * existing installs.
 *
 * **macOS** uses `security add-generic-password` / `find-generic-password` /
 * `delete-generic-password`. **Linux** uses `secret-tool` from libsecret.
 * Other platforms return an unavailable result so callers fall back to the
 * existing file-based store.
 */

export type KeychainBackend = "macos-security" | "linux-libsecret" | "unavailable";

export type KeychainAvailability =
  | { readonly available: true; readonly backend: KeychainBackend }
  | { readonly available: false; readonly reason: string };

export type KeychainSecretRef = {
  /** Service identifier — typically `"alien"` or `"alien-<channel>"`. */
  readonly service: string;
  /** Account identifier — operator-meaningful (e.g. `"gateway-token"`, channel id). */
  readonly account: string;
};

type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options?: SpawnSyncOptions,
) => SpawnSyncReturns<Buffer>;

export type OsKeychainOptions = {
  readonly platform?: NodeJS.Platform;
  readonly spawn?: SpawnFn;
};

export function detectKeychainBackend(options: OsKeychainOptions = {}): KeychainAvailability {
  const platform = options.platform ?? process.platform;
  const spawn = options.spawn ?? spawnSync;
  if (platform === "darwin") {
    const probe = spawn("security", ["-h"], { stdio: "ignore" });
    if (probe.status === 0 || probe.status === null) {
      return { available: true, backend: "macos-security" };
    }
    return { available: false, reason: "macOS `security` CLI is not callable" };
  }
  if (platform === "linux") {
    const probe = spawn("secret-tool", ["--help"], { stdio: "ignore" });
    if (probe.status === 0) {
      return { available: true, backend: "linux-libsecret" };
    }
    return {
      available: false,
      reason: "Linux libsecret `secret-tool` is not installed (apt: libsecret-tools)",
    };
  }
  return { available: false, reason: `keychain not supported on ${platform}` };
}

export function setKeychainSecret(
  ref: KeychainSecretRef,
  value: string,
  options: OsKeychainOptions = {},
): void {
  const availability = detectKeychainBackend(options);
  if (!availability.available) {
    throw new Error(`Keychain unavailable: ${availability.reason}`);
  }
  const spawn = options.spawn ?? spawnSync;
  if (availability.backend === "macos-security") {
    const result = spawn(
      "security",
      [
        "add-generic-password",
        "-U", // update if exists
        "-s",
        ref.service,
        "-a",
        ref.account,
        "-w",
        value,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    if (result.status !== 0) {
      throw new Error(
        `security add-generic-password failed: ${result.stderr?.toString().trim() || "unknown"}`,
      );
    }
    return;
  }
  // linux-libsecret
  const result = spawn(
    "secret-tool",
    [
      "store",
      "--label",
      `${ref.service}/${ref.account}`,
      "service",
      ref.service,
      "account",
      ref.account,
    ],
    { input: value, stdio: ["pipe", "pipe", "pipe"] },
  );
  if (result.status !== 0) {
    throw new Error(`secret-tool store failed: ${result.stderr?.toString().trim() || "unknown"}`);
  }
}

export function getKeychainSecret(
  ref: KeychainSecretRef,
  options: OsKeychainOptions = {},
): string | null {
  const availability = detectKeychainBackend(options);
  if (!availability.available) {
    return null;
  }
  const spawn = options.spawn ?? spawnSync;
  if (availability.backend === "macos-security") {
    const result = spawn(
      "security",
      ["find-generic-password", "-s", ref.service, "-a", ref.account, "-w"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    if (result.status !== 0) {
      return null;
    }
    const out = result.stdout?.toString() ?? "";
    return out.endsWith("\n") ? out.slice(0, -1) : out;
  }
  // linux-libsecret
  const result = spawn("secret-tool", ["lookup", "service", ref.service, "account", ref.account], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout?.toString() ?? null;
}

export function deleteKeychainSecret(
  ref: KeychainSecretRef,
  options: OsKeychainOptions = {},
): boolean {
  const availability = detectKeychainBackend(options);
  if (!availability.available) {
    return false;
  }
  const spawn = options.spawn ?? spawnSync;
  if (availability.backend === "macos-security") {
    const result = spawn(
      "security",
      ["delete-generic-password", "-s", ref.service, "-a", ref.account],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    return result.status === 0;
  }
  // linux-libsecret
  const result = spawn("secret-tool", ["clear", "service", ref.service, "account", ref.account], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0;
}
