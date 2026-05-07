import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempDir } from "./test-helpers/temp-dir.js";
import {
  ensureDir,
  resolveConfigDir,
  resolveHomeDir,
  resolveUserPath,
  shortenHomeInString,
  shortenHomePath,
  sleep,
} from "./utils.js";

describe("ensureDir", () => {
  it("creates nested directory", async () => {
    await withTempDir({ prefix: "alien-test-" }, async (tmp) => {
      const target = path.join(tmp, "nested", "dir");
      await ensureDir(target);
      expect(fs.existsSync(target)).toBe(true);
    });
  });
});

describe("sleep", () => {
  it("resolves after delay using fake timers", async () => {
    vi.useFakeTimers();
    try {
      const promise = sleep(1000);
      vi.advanceTimersByTime(1000);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("resolveConfigDir", () => {
  it("prefers ~/.alien when legacy dir is missing", async () => {
    await withTempDir({ prefix: "alien-config-dir-" }, async (root) => {
      const newDir = path.join(root, ".alien");
      await fs.promises.mkdir(newDir, { recursive: true });
      const resolved = resolveConfigDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    });
  });

  it("expands ALIEN_STATE_DIR using the provided env", () => {
    const env = {
      HOME: "/tmp/alien-home",
      ALIEN_STATE_DIR: "~/state",
    } as NodeJS.ProcessEnv;

    expect(resolveConfigDir(env)).toBe(path.resolve("/tmp/alien-home", "state"));
  });

  it("falls back to the config file directory when only ALIEN_CONFIG_PATH is set", () => {
    const env = {
      HOME: "/tmp/alien-home",
      ALIEN_CONFIG_PATH: "~/profiles/dev/alien.json",
    } as NodeJS.ProcessEnv;

    expect(resolveConfigDir(env)).toBe(path.resolve("/tmp/alien-home", "profiles", "dev"));
  });
});

describe("resolveHomeDir", () => {
  it("prefers ALIEN_HOME over HOME", () => {
    vi.stubEnv("ALIEN_HOME", "/srv/alien-home");
    vi.stubEnv("HOME", "/home/other");
    try {
      expect(resolveHomeDir()).toBe(path.resolve("/srv/alien-home"));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("shortenHomePath", () => {
  it("uses $ALIEN_HOME prefix when ALIEN_HOME is set", () => {
    vi.stubEnv("ALIEN_HOME", "/srv/alien-home");
    vi.stubEnv("HOME", "/home/other");
    try {
      expect(shortenHomePath(`${path.resolve("/srv/alien-home")}/.alien/alien.json`)).toBe(
        "$ALIEN_HOME/.alien/alien.json",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("shortenHomeInString", () => {
  it("uses $ALIEN_HOME replacement when ALIEN_HOME is set", () => {
    vi.stubEnv("ALIEN_HOME", "/srv/alien-home");
    vi.stubEnv("HOME", "/home/other");
    try {
      expect(
        shortenHomeInString(
          `config: ${path.resolve("/srv/alien-home")}/.alien/alien.json`,
        ),
      ).toBe("config: $ALIEN_HOME/.alien/alien.json");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("resolveUserPath", () => {
  it("expands ~ to home dir", () => {
    expect(resolveUserPath("~", {}, () => "/Users/thoffman")).toBe(path.resolve("/Users/thoffman"));
  });

  it("expands ~/ to home dir", () => {
    expect(resolveUserPath("~/alien", {}, () => "/Users/thoffman")).toBe(
      path.resolve("/Users/thoffman", "alien"),
    );
  });

  it("resolves relative paths", () => {
    expect(resolveUserPath("tmp/dir")).toBe(path.resolve("tmp/dir"));
  });

  it("prefers ALIEN_HOME for tilde expansion", () => {
    vi.stubEnv("ALIEN_HOME", "/srv/alien-home");
    vi.stubEnv("HOME", "/home/other");
    try {
      expect(resolveUserPath("~/alien")).toBe(path.resolve("/srv/alien-home", "alien"));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("uses the provided env for tilde expansion", () => {
    const env = {
      HOME: "/tmp/alien-home",
      ALIEN_HOME: "/srv/alien-home",
    } as NodeJS.ProcessEnv;

    expect(resolveUserPath("~/alien", env)).toBe(path.resolve("/srv/alien-home", "alien"));
  });

  it("keeps blank paths blank", () => {
    expect(resolveUserPath("")).toBe("");
    expect(resolveUserPath("   ")).toBe("");
  });

  it("returns empty string for undefined/null input", () => {
    expect(resolveUserPath(undefined as unknown as string)).toBe("");
    expect(resolveUserPath(null as unknown as string)).toBe("");
  });
});
