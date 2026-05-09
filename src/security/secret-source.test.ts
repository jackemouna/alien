import type { SpawnSyncReturns } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  readSecretFromEnvOrKeychain,
  resolveSecretFromEnvOrKeychain,
  SECRETS_FROM_KEYCHAIN_ENV,
} from "./secret-source.js";

function spawnReturn(params: {
  status?: number | null;
  stdout?: string;
  stderr?: string;
}): SpawnSyncReturns<Buffer> {
  return {
    pid: 0,
    output: [],
    stdout: Buffer.from(params.stdout ?? ""),
    stderr: Buffer.from(params.stderr ?? ""),
    status: params.status ?? 0,
    signal: null,
  };
}

const KEYCHAIN_ARGS = {
  service: "alien-test",
  account: "secret",
};

describe("resolveSecretFromEnvOrKeychain", () => {
  it("returns the env value when present, source='env'", () => {
    const result = resolveSecretFromEnvOrKeychain({
      envVarName: "MY_KEY",
      keychain: KEYCHAIN_ARGS,
      env: { MY_KEY: "from-env" },
    });
    expect(result).toEqual({ source: "env", value: "from-env" });
  });

  it("does not consult the keychain when env value is present", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 0, stdout: "from-keychain" }));
    const result = resolveSecretFromEnvOrKeychain({
      envVarName: "MY_KEY",
      keychain: KEYCHAIN_ARGS,
      env: { MY_KEY: "from-env" },
      keychainOptions: { platform: "darwin", spawn },
    });
    expect(result.source).toBe("env");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns missing when env is empty AND global flag is unset", () => {
    const result = resolveSecretFromEnvOrKeychain({
      envVarName: "MY_KEY",
      keychain: KEYCHAIN_ARGS,
      env: {},
    });
    expect(result).toEqual({ source: "missing" });
  });

  it("falls back to keychain when global flag is set", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 0, stdout: "from-keychain\n" });
    });
    const result = resolveSecretFromEnvOrKeychain({
      envVarName: "MY_KEY",
      keychain: KEYCHAIN_ARGS,
      env: { [SECRETS_FROM_KEYCHAIN_ENV]: "1" },
      keychainOptions: { platform: "darwin", spawn },
    });
    expect(result).toEqual({ source: "keychain", value: "from-keychain" });
  });

  it("falls back to keychain unconditionally when keychainGate='always'", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 0, stdout: "kc\n" });
    });
    const result = resolveSecretFromEnvOrKeychain({
      envVarName: "MY_KEY",
      keychain: KEYCHAIN_ARGS,
      env: {},
      keychainGate: "always",
      keychainOptions: { platform: "darwin", spawn },
    });
    expect(result).toEqual({ source: "keychain", value: "kc" });
  });

  it("returns missing when keychain is unavailable", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 1 }));
    const result = resolveSecretFromEnvOrKeychain({
      envVarName: "MY_KEY",
      keychain: KEYCHAIN_ARGS,
      env: {},
      keychainGate: "always",
      keychainOptions: { platform: "darwin", spawn },
    });
    expect(result).toEqual({ source: "missing" });
  });

  it("returns missing when keychain entry is empty", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 0, stdout: "" });
    });
    const result = resolveSecretFromEnvOrKeychain({
      envVarName: "MY_KEY",
      keychain: KEYCHAIN_ARGS,
      env: {},
      keychainGate: "always",
      keychainOptions: { platform: "darwin", spawn },
    });
    expect(result).toEqual({ source: "missing" });
  });

  it("treats empty-string env values as missing (falls through to keychain when allowed)", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 0, stdout: "kc\n" });
    });
    const result = resolveSecretFromEnvOrKeychain({
      envVarName: "MY_KEY",
      keychain: KEYCHAIN_ARGS,
      env: { MY_KEY: "" },
      keychainGate: "always",
      keychainOptions: { platform: "darwin", spawn },
    });
    expect(result.source).toBe("keychain");
  });

  it("ignores ALIEN_SECRETS_FROM_KEYCHAIN values other than '1'", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 0, stdout: "kc\n" }));
    for (const value of ["true", "yes", "0", ""]) {
      const result = resolveSecretFromEnvOrKeychain({
        envVarName: "MY_KEY",
        keychain: KEYCHAIN_ARGS,
        env: { [SECRETS_FROM_KEYCHAIN_ENV]: value },
        keychainOptions: { platform: "darwin", spawn },
      });
      expect(result.source).toBe("missing");
    }
  });
});

describe("readSecretFromEnvOrKeychain (convenience)", () => {
  it("returns the value or undefined", () => {
    expect(
      readSecretFromEnvOrKeychain({
        envVarName: "MY_KEY",
        keychain: KEYCHAIN_ARGS,
        env: { MY_KEY: "v" },
      }),
    ).toBe("v");

    expect(
      readSecretFromEnvOrKeychain({
        envVarName: "MY_KEY",
        keychain: KEYCHAIN_ARGS,
        env: {},
      }),
    ).toBeUndefined();
  });
});
