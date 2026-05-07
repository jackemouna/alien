import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "alien",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "alien", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("leaves gateway --dev for subcommands after leading root options", () => {
    const res = parseCliProfileArgs([
      "node",
      "alien",
      "--no-color",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual([
      "node",
      "alien",
      "--no-color",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "alien", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "alien", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "alien", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "alien", "status"]);
  });

  it("parses interleaved --profile after the command token", () => {
    const res = parseCliProfileArgs(["node", "alien", "status", "--profile", "work", "--deep"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "alien", "status", "--deep"]);
  });

  it("preserves Matrix QA --profile for the command parser", () => {
    const res = parseCliProfileArgs([
      "node",
      "alien",
      "qa",
      "matrix",
      "--profile",
      "fast",
      "--fail-fast",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual([
      "node",
      "alien",
      "qa",
      "matrix",
      "--profile",
      "fast",
      "--fail-fast",
    ]);
  });

  it("preserves Matrix QA --profile after leading root options", () => {
    const res = parseCliProfileArgs([
      "node",
      "alien",
      "--no-color",
      "qa",
      "matrix",
      "--profile=fast",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "alien", "--no-color", "qa", "matrix", "--profile=fast"]);
  });

  it("still parses root --profile before Matrix QA", () => {
    const res = parseCliProfileArgs([
      "node",
      "alien",
      "--profile",
      "work",
      "qa",
      "matrix",
      "--fail-fast",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "alien", "qa", "matrix", "--fail-fast"]);
  });

  it("parses interleaved --dev after the command token", () => {
    const res = parseCliProfileArgs(["node", "alien", "status", "--dev"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "alien", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "alien", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "alien", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "alien", "--profile", "work", "--dev", "status"]],
    ["interleaved after command", ["node", "alien", "status", "--profile", "work", "--dev"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".alien-dev");
    expect(env.ALIEN_PROFILE).toBe("dev");
    expect(env.ALIEN_STATE_DIR).toBe(expectedStateDir);
    expect(env.ALIEN_CONFIG_PATH).toBe(path.join(expectedStateDir, "alien.json"));
    expect(env.ALIEN_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      ALIEN_STATE_DIR: "/custom",
      ALIEN_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.ALIEN_STATE_DIR).toBe("/custom");
    expect(env.ALIEN_GATEWAY_PORT).toBe("19099");
    expect(env.ALIEN_CONFIG_PATH).toBe(path.join("/custom", "alien.json"));
  });

  it("uses ALIEN_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      ALIEN_HOME: "/srv/alien-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/alien-home");
    expect(env.ALIEN_STATE_DIR).toBe(path.join(resolvedHome, ".alien-work"));
    expect(env.ALIEN_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".alien-work", "alien.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "alien doctor --fix",
      env: {},
      expected: "alien doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "alien doctor --fix",
      env: { ALIEN_PROFILE: "default" },
      expected: "alien doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "alien doctor --fix",
      env: { ALIEN_PROFILE: "Default" },
      expected: "alien doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "alien doctor --fix",
      env: { ALIEN_PROFILE: "bad profile" },
      expected: "alien doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "alien --profile work doctor --fix",
      env: { ALIEN_PROFILE: "work" },
      expected: "alien --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "alien --dev doctor",
      env: { ALIEN_PROFILE: "dev" },
      expected: "alien --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("alien doctor --fix", { ALIEN_PROFILE: "work" })).toBe(
      "alien --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("alien doctor --fix", { ALIEN_PROFILE: "  jbalien  " })).toBe(
      "alien --profile jbalien doctor --fix",
    );
  });

  it("handles command with no args after alien", () => {
    expect(formatCliCommand("alien", { ALIEN_PROFILE: "test" })).toBe(
      "alien --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm alien doctor", { ALIEN_PROFILE: "work" })).toBe(
      "pnpm alien --profile work doctor",
    );
  });

  it("inserts --container when a container hint is set", () => {
    expect(
      formatCliCommand("alien gateway status --deep", { ALIEN_CONTAINER_HINT: "demo" }),
    ).toBe("alien --container demo gateway status --deep");
  });

  it("ignores unsafe container hints", () => {
    expect(
      formatCliCommand("alien gateway status --deep", {
        ALIEN_CONTAINER_HINT: "demo; rm -rf /",
      }),
    ).toBe("alien gateway status --deep");
  });

  it("preserves both --container and --profile hints", () => {
    expect(
      formatCliCommand("alien doctor", {
        ALIEN_CONTAINER_HINT: "demo",
        ALIEN_PROFILE: "work",
      }),
    ).toBe("alien --container demo doctor");
  });

  it("does not prepend --container for update commands", () => {
    expect(formatCliCommand("alien update", { ALIEN_CONTAINER_HINT: "demo" })).toBe(
      "alien update",
    );
    expect(
      formatCliCommand("pnpm alien update --channel beta", { ALIEN_CONTAINER_HINT: "demo" }),
    ).toBe("pnpm alien update --channel beta");
  });
});
