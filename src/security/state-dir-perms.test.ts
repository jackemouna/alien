import type fs from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveStateDirPermsWarning } from "./state-dir-perms.js";

function fakeStat(mode: number, isDir = true): fs.Stats {
  return {
    mode,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as unknown as fs.Stats;
}

describe("resolveStateDirPermsWarning", () => {
  it("returns null for 0o700 (correct mode)", () => {
    const warn = resolveStateDirPermsWarning({
      stateDir: "/tmp/alien",
      statSync: () => fakeStat(0o700),
      platform: "darwin",
    });
    expect(warn).toBeNull();
  });

  it("returns null on Windows (mode bits don't apply)", () => {
    const warn = resolveStateDirPermsWarning({
      stateDir: "/tmp/alien",
      statSync: () => fakeStat(0o777),
      platform: "win32",
    });
    expect(warn).toBeNull();
  });

  it("returns null when the directory doesn't exist", () => {
    const warn = resolveStateDirPermsWarning({
      stateDir: "/tmp/alien-missing",
      statSync: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      platform: "darwin",
    });
    expect(warn).toBeNull();
  });

  it("returns null when the path is not a directory", () => {
    const warn = resolveStateDirPermsWarning({
      stateDir: "/tmp/alien-file",
      statSync: () => fakeStat(0o644, false),
      platform: "darwin",
    });
    expect(warn).toBeNull();
  });

  it("returns null for owner-only modes that are tighter (e.g. 0o600)", () => {
    const warn = resolveStateDirPermsWarning({
      stateDir: "/tmp/alien",
      statSync: () => fakeStat(0o600),
      platform: "darwin",
    });
    expect(warn).toBeNull();
  });

  it("warns when world-readable (0o755)", () => {
    const warn = resolveStateDirPermsWarning({
      stateDir: "/tmp/alien",
      statSync: () => fakeStat(0o755),
      platform: "darwin",
    });
    expect(warn).not.toBeNull();
    expect(warn).toMatch(/world-readable/);
    expect(warn).toMatch(/0o755/);
    expect(warn).toMatch(/M5/);
  });

  it("warns when group-readable (0o750)", () => {
    const warn = resolveStateDirPermsWarning({
      stateDir: "/tmp/alien",
      statSync: () => fakeStat(0o750),
      platform: "darwin",
    });
    expect(warn).toMatch(/group-readable/);
    expect(warn).not.toMatch(/world-readable/);
  });

  it("warns when world-writable", () => {
    const warn = resolveStateDirPermsWarning({
      stateDir: "/tmp/alien",
      statSync: () => fakeStat(0o707),
      platform: "darwin",
    });
    expect(warn).toMatch(/world-writable/);
  });

  it("warns when permissions are 0o777 (worst case)", () => {
    const warn = resolveStateDirPermsWarning({
      stateDir: "/tmp/alien",
      statSync: () => fakeStat(0o777),
      platform: "darwin",
    });
    expect(warn).toMatch(/world-writable/);
    expect(warn).toMatch(/group-readable/);
  });

  it("includes a chmod 700 fix in the warning", () => {
    const warn = resolveStateDirPermsWarning({
      stateDir: "/tmp/alien",
      statSync: () => fakeStat(0o755),
      platform: "darwin",
    });
    expect(warn).toMatch(/chmod 700/);
  });
});
