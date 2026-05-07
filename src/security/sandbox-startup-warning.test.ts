import { describe, expect, it } from "vitest";
import type { AlienConfig } from "../config/types.alien.js";
import { resolveSandboxStartupWarning } from "./sandbox-startup-warning.js";

function cfgWithMode(mode: string | undefined): AlienConfig {
  return { agents: { defaults: { sandbox: mode ? { mode } : {} } } } as unknown as AlienConfig;
}

describe("resolveSandboxStartupWarning", () => {
  it("warns when mode is unset and ALIEN_HARDENED_DEFAULTS is not set", () => {
    const result = resolveSandboxStartupWarning({ cfg: undefined, env: {} });
    expect(result).not.toBeNull();
    expect(result).toMatch(/Sandbox is OFF/);
    expect(result).toMatch(/H1/);
    expect(result).toMatch(/ALIEN_HARDENED_DEFAULTS/);
  });

  it("warns when mode is explicitly 'off'", () => {
    const result = resolveSandboxStartupWarning({ cfg: cfgWithMode("off"), env: {} });
    expect(result).toMatch(/explicit/);
  });

  it("returns null when mode is explicitly 'docker'", () => {
    expect(resolveSandboxStartupWarning({ cfg: cfgWithMode("docker"), env: {} })).toBeNull();
  });

  it("returns null when mode is 'ssh'", () => {
    expect(resolveSandboxStartupWarning({ cfg: cfgWithMode("ssh"), env: {} })).toBeNull();
  });

  it("returns null when mode is 'openshell'", () => {
    expect(resolveSandboxStartupWarning({ cfg: cfgWithMode("openshell"), env: {} })).toBeNull();
  });

  it("returns null when mode is 'all'", () => {
    expect(resolveSandboxStartupWarning({ cfg: cfgWithMode("all"), env: {} })).toBeNull();
  });

  it("returns null when mode is unset but ALIEN_HARDENED_DEFAULTS=1", () => {
    const result = resolveSandboxStartupWarning({
      cfg: undefined,
      env: { ALIEN_HARDENED_DEFAULTS: "1" },
    });
    expect(result).toBeNull();
  });

  it("still warns when mode is explicitly 'off' even with ALIEN_HARDENED_DEFAULTS=1", () => {
    const result = resolveSandboxStartupWarning({
      cfg: cfgWithMode("off"),
      env: { ALIEN_HARDENED_DEFAULTS: "1" },
    });
    // Operator's explicit 'off' wins, but they should still see the warning.
    expect(result).not.toBeNull();
  });

  it("ignores ALIEN_HARDENED_DEFAULTS values other than '1'", () => {
    for (const value of ["true", "yes", "0", ""]) {
      const result = resolveSandboxStartupWarning({
        cfg: undefined,
        env: { ALIEN_HARDENED_DEFAULTS: value },
      });
      expect(result).not.toBeNull();
    }
  });
});
