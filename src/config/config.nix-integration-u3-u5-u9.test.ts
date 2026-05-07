import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GATEWAY_PORT,
  resolveConfigPathCandidate,
  resolveGatewayPort,
  resolveIsNixMode,
  resolveStateDir,
} from "./config.js";
import { withTempHome } from "./test-helpers.js";

vi.unmock("../version.js");

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  // Hermetic env: don't inherit process.env because other tests may mutate it.
  return { ...overrides };
}

describe("Nix integration (U3, U5, U9)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("U3: isNixMode env var detection", () => {
    it("isNixMode is false when ALIEN_NIX_MODE is not set", () => {
      expect(resolveIsNixMode(envWith({ ALIEN_NIX_MODE: undefined }))).toBe(false);
    });

    it("isNixMode is false when ALIEN_NIX_MODE is empty", () => {
      expect(resolveIsNixMode(envWith({ ALIEN_NIX_MODE: "" }))).toBe(false);
    });

    it("isNixMode is false when ALIEN_NIX_MODE is not '1'", () => {
      expect(resolveIsNixMode(envWith({ ALIEN_NIX_MODE: "true" }))).toBe(false);
    });

    it("isNixMode is true when ALIEN_NIX_MODE=1", () => {
      expect(resolveIsNixMode(envWith({ ALIEN_NIX_MODE: "1" }))).toBe(true);
    });
  });

  describe("U5: CONFIG_PATH and STATE_DIR env var overrides", () => {
    it("STATE_DIR defaults to ~/.alien when env not set", () => {
      expect(resolveStateDir(envWith({ ALIEN_STATE_DIR: undefined }))).toMatch(/\.alien$/);
    });

    it("STATE_DIR respects ALIEN_STATE_DIR override", () => {
      expect(resolveStateDir(envWith({ ALIEN_STATE_DIR: "/custom/state/dir" }))).toBe(
        path.resolve("/custom/state/dir"),
      );
    });

    it("STATE_DIR respects ALIEN_HOME when state override is unset", () => {
      const customHome = path.join(path.sep, "custom", "home");
      expect(
        resolveStateDir(envWith({ ALIEN_HOME: customHome, ALIEN_STATE_DIR: undefined })),
      ).toBe(path.join(path.resolve(customHome), ".alien"));
    });

    it("CONFIG_PATH defaults to ALIEN_HOME/.alien/alien.json", () => {
      const customHome = path.join(path.sep, "custom", "home");
      expect(
        resolveConfigPathCandidate(
          envWith({
            ALIEN_HOME: customHome,
            ALIEN_CONFIG_PATH: undefined,
            ALIEN_STATE_DIR: undefined,
          }),
        ),
      ).toBe(path.join(path.resolve(customHome), ".alien", "alien.json"));
    });

    it("CONFIG_PATH defaults to ~/.alien/alien.json when env not set", () => {
      expect(
        resolveConfigPathCandidate(
          envWith({ ALIEN_CONFIG_PATH: undefined, ALIEN_STATE_DIR: undefined }),
        ),
      ).toMatch(/\.alien[\\/]alien\.json$/);
    });

    it("CONFIG_PATH respects ALIEN_CONFIG_PATH override", () => {
      expect(
        resolveConfigPathCandidate(
          envWith({ ALIEN_CONFIG_PATH: "/nix/store/abc/alien.json" }),
        ),
      ).toBe(path.resolve("/nix/store/abc/alien.json"));
    });

    it("CONFIG_PATH expands ~ in ALIEN_CONFIG_PATH override", async () => {
      await withTempHome(async (home) => {
        expect(
          resolveConfigPathCandidate(
            envWith({ ALIEN_HOME: home, ALIEN_CONFIG_PATH: "~/.alien/custom.json" }),
            () => home,
          ),
        ).toBe(path.join(home, ".alien", "custom.json"));
      });
    });

    it("CONFIG_PATH uses STATE_DIR when only state dir is overridden", () => {
      expect(
        resolveConfigPathCandidate(
          envWith({ ALIEN_STATE_DIR: "/custom/state", ALIEN_TEST_FAST: "1" }),
          () => path.join(path.sep, "tmp", "alien-config-home"),
        ),
      ).toBe(path.join(path.resolve("/custom/state"), "alien.json"));
    });
  });

  describe("U6: gateway port resolution", () => {
    it("uses default when env and config are unset", () => {
      expect(resolveGatewayPort({}, envWith({ ALIEN_GATEWAY_PORT: undefined }))).toBe(
        DEFAULT_GATEWAY_PORT,
      );
    });

    it("prefers ALIEN_GATEWAY_PORT over config", () => {
      expect(
        resolveGatewayPort(
          { gateway: { port: 19002 } },
          envWith({ ALIEN_GATEWAY_PORT: "19001" }),
        ),
      ).toBe(19001);
    });

    it("falls back to config when env is invalid", () => {
      expect(
        resolveGatewayPort(
          { gateway: { port: 19003 } },
          envWith({ ALIEN_GATEWAY_PORT: "nope" }),
        ),
      ).toBe(19003);
    });
  });
});
