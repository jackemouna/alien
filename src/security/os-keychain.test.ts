import type { SpawnSyncReturns } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  deleteKeychainSecret,
  detectKeychainBackend,
  getKeychainSecret,
  setKeychainSecret,
} from "./os-keychain.js";

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

describe("detectKeychainBackend", () => {
  it("returns macos-security on darwin when `security -h` succeeds", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 0 }));
    const result = detectKeychainBackend({ platform: "darwin", spawn });
    expect(result).toEqual({ available: true, backend: "macos-security" });
    expect(spawn).toHaveBeenCalledWith("security", ["-h"], { stdio: "ignore" });
  });

  it("returns linux-libsecret when secret-tool is present", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 0 }));
    const result = detectKeychainBackend({ platform: "linux", spawn });
    expect(result).toEqual({ available: true, backend: "linux-libsecret" });
    expect(spawn).toHaveBeenCalledWith("secret-tool", ["--help"], { stdio: "ignore" });
  });

  it("returns unavailable on linux without secret-tool", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 127 }));
    const result = detectKeychainBackend({ platform: "linux", spawn });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toMatch(/secret-tool/);
    }
  });

  it("returns unavailable on win32", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 0 }));
    const result = detectKeychainBackend({ platform: "win32", spawn });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toMatch(/win32/);
    }
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("setKeychainSecret", () => {
  it("invokes `security add-generic-password -U` on macOS", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 0 });
    });
    setKeychainSecret({ service: "alien", account: "gateway-token" }, "tok_xyz", {
      platform: "darwin",
      spawn,
    });
    const addCall = spawn.mock.calls.find(
      (c) => c[0] === "security" && c[1][0] === "add-generic-password",
    );
    expect(addCall).toBeDefined();
    expect(addCall?.[1]).toEqual([
      "add-generic-password",
      "-U",
      "-s",
      "alien",
      "-a",
      "gateway-token",
      "-w",
      "tok_xyz",
    ]);
  });

  it("throws when the macOS security command fails", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 1, stderr: "denied" });
    });
    expect(() =>
      setKeychainSecret({ service: "alien", account: "gateway-token" }, "tok", {
        platform: "darwin",
        spawn,
      }),
    ).toThrow(/security add-generic-password failed/);
  });

  it("invokes `secret-tool store` on linux with the value on stdin", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "secret-tool" && args[0] === "--help") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 0 });
    });
    setKeychainSecret({ service: "alien", account: "ot" }, "value", {
      platform: "linux",
      spawn,
    });
    const storeCall = spawn.mock.calls.find((c) => c[0] === "secret-tool" && c[1][0] === "store");
    expect(storeCall).toBeDefined();
    expect(storeCall?.[1]).toContain("service");
    expect(storeCall?.[1]).toContain("alien");
    expect(storeCall?.[2]?.input).toBe("value");
  });

  it("throws when keychain is unavailable", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 1 }));
    expect(() =>
      setKeychainSecret({ service: "alien", account: "k" }, "v", {
        platform: "darwin",
        spawn,
      }),
    ).toThrow(/Keychain unavailable/);
  });
});

describe("getKeychainSecret", () => {
  it("returns the trimmed stdout from `security find-generic-password -w`", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 0, stdout: "tok_xyz\n" });
    });
    const v = getKeychainSecret(
      { service: "alien", account: "gateway-token" },
      { platform: "darwin", spawn },
    );
    expect(v).toBe("tok_xyz");
  });

  it("returns null when the secret is not found", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 44, stderr: "not found" });
    });
    const v = getKeychainSecret(
      { service: "alien", account: "missing" },
      { platform: "darwin", spawn },
    );
    expect(v).toBeNull();
  });

  it("returns null on win32 (keychain unsupported)", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 0 }));
    expect(
      getKeychainSecret({ service: "alien", account: "x" }, { platform: "win32", spawn }),
    ).toBeNull();
  });
});

describe("deleteKeychainSecret", () => {
  it("returns true when delete succeeds on macOS", () => {
    const spawn = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "security" && args[0] === "-h") return spawnReturn({ status: 0 });
      return spawnReturn({ status: 0 });
    });
    expect(
      deleteKeychainSecret({ service: "alien", account: "k" }, { platform: "darwin", spawn }),
    ).toBe(true);
  });

  it("returns false when keychain is unavailable", () => {
    const spawn = vi.fn(() => spawnReturn({ status: 1 }));
    expect(
      deleteKeychainSecret({ service: "alien", account: "k" }, { platform: "darwin", spawn }),
    ).toBe(false);
  });
});
