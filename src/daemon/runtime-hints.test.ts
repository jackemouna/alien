import { describe, expect, it } from "vitest";
import { buildPlatformRuntimeLogHints, buildPlatformServiceStartHints } from "./runtime-hints.js";

describe("buildPlatformRuntimeLogHints", () => {
  it("renders launchd log hints on darwin", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        env: {
          ALIEN_STATE_DIR: "/tmp/alien-state",
          ALIEN_LOG_PREFIX: "gateway",
        },
        systemdServiceName: "alien-gateway",
        windowsTaskName: "Alien Gateway",
      }),
    ).toEqual([
      "Launchd stdout (if installed): /tmp/alien-state/logs/gateway.log",
      "Launchd stderr (if installed): /tmp/alien-state/logs/gateway.err.log",
      "Restart attempts: /tmp/alien-state/logs/gateway-restart.log",
    ]);
  });

  it("renders systemd and windows hints by platform", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "linux",
        env: {
          ALIEN_STATE_DIR: "/tmp/alien-state",
        },
        systemdServiceName: "alien-gateway",
        windowsTaskName: "Alien Gateway",
      }),
    ).toEqual([
      "Logs: journalctl --user -u alien-gateway.service -n 200 --no-pager",
      "Restart attempts: /tmp/alien-state/logs/gateway-restart.log",
    ]);
    expect(
      buildPlatformRuntimeLogHints({
        platform: "win32",
        env: {
          ALIEN_STATE_DIR: "/tmp/alien-state",
        },
        systemdServiceName: "alien-gateway",
        windowsTaskName: "Alien Gateway",
      }),
    ).toEqual([
      'Logs: schtasks /Query /TN "Alien Gateway" /V /FO LIST',
      "Restart attempts: /tmp/alien-state/logs/gateway-restart.log",
    ]);
  });
});

describe("buildPlatformServiceStartHints", () => {
  it("builds platform-specific service start hints", () => {
    expect(
      buildPlatformServiceStartHints({
        platform: "darwin",
        installCommand: "alien gateway install",
        startCommand: "alien gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.alien.gateway.plist",
        systemdServiceName: "alien-gateway",
        windowsTaskName: "Alien Gateway",
      }),
    ).toEqual([
      "alien gateway install",
      "alien gateway",
      "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.alien.gateway.plist",
    ]);
    expect(
      buildPlatformServiceStartHints({
        platform: "linux",
        installCommand: "alien gateway install",
        startCommand: "alien gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.alien.gateway.plist",
        systemdServiceName: "alien-gateway",
        windowsTaskName: "Alien Gateway",
      }),
    ).toEqual([
      "alien gateway install",
      "alien gateway",
      "systemctl --user start alien-gateway.service",
    ]);
  });
});
