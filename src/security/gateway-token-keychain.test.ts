import type { SpawnSyncReturns } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  GATEWAY_TOKEN_ACCOUNT,
  GATEWAY_TOKEN_SERVICE,
  clearGatewayTokenFromKeychain,
  isGatewayTokenKeychainAvailable,
  loadGatewayTokenFromKeychain,
  resolveGatewayTokenKeychainPolicy,
  saveGatewayTokenToKeychain,
} from "./gateway-token-keychain.js";

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

describe("resolveGatewayTokenKeychainPolicy", () => {
  it("returns 'preferred' only for ALIEN_GATEWAY_TOKEN_KEYCHAIN=1", () => {
    expect(resolveGatewayTokenKeychainPolicy({ ALIEN_GATEWAY_TOKEN_KEYCHAIN: "1" })).toBe(
      "preferred",
    );
  });

  it("returns 'off' for missing/empty/garbage values", () => {
    expect(resolveGatewayTokenKeychainPolicy({})).toBe("off");
    expect(resolveGatewayTokenKeychainPolicy({ ALIEN_GATEWAY_TOKEN_KEYCHAIN: "" })).toBe("off");
    expect(resolveGatewayTokenKeychainPolicy({ ALIEN_GATEWAY_TOKEN_KEYCHAIN: "yes" })).toBe("off");
    expect(resolveGatewayTokenKeychainPolicy({ ALIEN_GATEWAY_TOKEN_KEYCHAIN: "0" })).toBe("off");
  });
});

describe("isGatewayTokenKeychainAvailable", () => {
  it("delegates to detectKeychainBackend (darwin happy path)", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 0 }));
    const result = isGatewayTokenKeychainAvailable({ platform: "darwin", spawn });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.backend).toBe("macos-security");
    }
  });

  it("returns unavailable on win32", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 0 }));
    const result = isGatewayTokenKeychainAvailable({ platform: "win32", spawn });
    expect(result.available).toBe(false);
  });
});

describe("loadGatewayTokenFromKeychain", () => {
  it("returns the trimmed token from `security find-generic-password`", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 0, stdout: "tok_secret\n" });
    });
    const value = loadGatewayTokenFromKeychain({ platform: "darwin", spawn });
    expect(value).toBe("tok_secret");
    const findCall = spawn.mock.calls.find(
      (c) => c[0] === "security" && c[1][0] === "find-generic-password",
    );
    expect(findCall?.[1]).toEqual([
      "find-generic-password",
      "-s",
      GATEWAY_TOKEN_SERVICE,
      "-a",
      GATEWAY_TOKEN_ACCOUNT,
      "-w",
    ]);
  });

  it("returns null when the entry is missing", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 44 });
    });
    expect(loadGatewayTokenFromKeychain({ platform: "darwin", spawn })).toBeNull();
  });

  it("returns null when keychain is unavailable", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 1 }));
    expect(loadGatewayTokenFromKeychain({ platform: "darwin", spawn })).toBeNull();
  });

  it("returns null when stdout is empty", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 0, stdout: "" });
    });
    expect(loadGatewayTokenFromKeychain({ platform: "darwin", spawn })).toBeNull();
  });
});

describe("saveGatewayTokenToKeychain", () => {
  it("invokes `security add-generic-password -U` with the gateway service/account", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 0 });
    });
    saveGatewayTokenToKeychain("tok_xyz", { platform: "darwin", spawn });
    const addCall = spawn.mock.calls.find(
      (c) => c[0] === "security" && c[1][0] === "add-generic-password",
    );
    expect(addCall?.[1]).toEqual([
      "add-generic-password",
      "-U",
      "-s",
      GATEWAY_TOKEN_SERVICE,
      "-a",
      GATEWAY_TOKEN_ACCOUNT,
      "-w",
      "tok_xyz",
    ]);
  });

  it("throws on empty token", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 0 }));
    expect(() => saveGatewayTokenToKeychain("", { platform: "darwin", spawn })).toThrow(
      /non-empty/,
    );
  });

  it("propagates keychain failures", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 1, stderr: "denied" });
    });
    expect(() => saveGatewayTokenToKeychain("tok", { platform: "darwin", spawn })).toThrow(
      /security add-generic-password failed/,
    );
  });
});

describe("clearGatewayTokenFromKeychain", () => {
  it("returns true when delete succeeds", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 0 });
    });
    expect(clearGatewayTokenFromKeychain({ platform: "darwin", spawn })).toBe(true);
  });

  it("returns false when keychain is unavailable", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 1 }));
    expect(clearGatewayTokenFromKeychain({ platform: "darwin", spawn })).toBe(false);
  });
});
