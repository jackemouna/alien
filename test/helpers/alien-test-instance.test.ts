import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAlienTestInstance } from "./alien-test-instance.js";

describe("alien test instance", () => {
  it("creates isolated config and spawn env without mutating process env", async () => {
    const previousHome = process.env.HOME;
    const inst = await createAlienTestInstance({
      name: "instance-unit",
      gatewayToken: "gateway-token",
      hookToken: "hook-token",
      config: {
        gateway: {
          bind: "loopback",
        },
      },
      env: {
        ALIEN_SKIP_CRON: "0",
      },
    });

    try {
      expect(process.env.HOME).toBe(previousHome);
      expect(inst.homeDir).toBe(path.join(inst.state.root, "home"));
      expect(inst.stateDir).toBe(path.join(inst.homeDir, ".alien"));
      expect(inst.configPath).toBe(path.join(inst.stateDir, "alien.json"));
      expect(inst.env.HOME).toBe(inst.homeDir);
      expect(inst.env.ALIEN_STATE_DIR).toBe(inst.stateDir);
      expect(inst.env.ALIEN_CONFIG_PATH).toBe(inst.configPath);
      expect(inst.env.ALIEN_SKIP_CRON).toBe("0");

      const config = JSON.parse(await fs.readFile(inst.configPath, "utf8"));
      expect(config).toMatchObject({
        gateway: {
          bind: "loopback",
          port: inst.port,
          auth: {
            mode: "token",
            token: "gateway-token",
          },
          controlUi: {
            enabled: false,
          },
        },
        hooks: {
          enabled: true,
          token: "hook-token",
          path: "/hooks",
        },
      });
    } finally {
      await inst.cleanup();
    }

    await expect(fs.stat(inst.state.root)).rejects.toThrow();
  });
});
