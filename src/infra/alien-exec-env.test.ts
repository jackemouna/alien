import { describe, expect, it } from "vitest";
import {
  ensureAlienExecMarkerOnProcess,
  markAlienExecEnv,
  ALIEN_CLI_ENV_VALUE,
  ALIEN_CLI_ENV_VAR,
} from "./alien-exec-env.js";

describe("markAlienExecEnv", () => {
  it("returns a cloned env object with the exec marker set", () => {
    const env = { PATH: "/usr/bin", ALIEN_CLI: "0" };
    const marked = markAlienExecEnv(env);

    expect(marked).toEqual({
      PATH: "/usr/bin",
      ALIEN_CLI: ALIEN_CLI_ENV_VALUE,
    });
    expect(marked).not.toBe(env);
    expect(env.ALIEN_CLI).toBe("0");
  });
});

describe("ensureAlienExecMarkerOnProcess", () => {
  it.each([
    {
      name: "mutates and returns the provided process env",
      env: { PATH: "/usr/bin" } as NodeJS.ProcessEnv,
    },
    {
      name: "overwrites an existing marker on the provided process env",
      env: { PATH: "/usr/bin", [ALIEN_CLI_ENV_VAR]: "0" } as NodeJS.ProcessEnv,
    },
  ])("$name", ({ env }) => {
    expect(ensureAlienExecMarkerOnProcess(env)).toBe(env);
    expect(env[ALIEN_CLI_ENV_VAR]).toBe(ALIEN_CLI_ENV_VALUE);
  });

  it("defaults to mutating process.env when no env object is provided", () => {
    const previous = process.env[ALIEN_CLI_ENV_VAR];
    delete process.env[ALIEN_CLI_ENV_VAR];

    try {
      expect(ensureAlienExecMarkerOnProcess()).toBe(process.env);
      expect(process.env[ALIEN_CLI_ENV_VAR]).toBe(ALIEN_CLI_ENV_VALUE);
    } finally {
      if (previous === undefined) {
        delete process.env[ALIEN_CLI_ENV_VAR];
      } else {
        process.env[ALIEN_CLI_ENV_VAR] = previous;
      }
    }
  });
});
