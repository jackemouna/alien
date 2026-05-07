import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlienConfig } from "../config/types.alien.js";

const noteMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const { mockNodeChildProcessSpawnSync } = await import("alien/plugin-sdk/test-node-mocks");
  return mockNodeChildProcessSpawnSync(spawnSyncMock);
});

vi.mock("../terminal/note.js", () => ({
  note: noteMock,
}));

const { listLocalTuiProcesses, noteWhatsappResponsivenessHealth, terminateLocalTuiProcesses } =
  await import("./doctor-whatsapp-responsiveness.js");

describe("doctor WhatsApp responsiveness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only verified local TUI processes", () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: [
        " 101 alien-tui",
        " 102 /usr/bin/node /usr/lib/node_modules/alien/dist/index.js gateway --port 18789",
        " 103 alien channels",
        " 104 alien tui --local",
      ].join("\n"),
    });

    expect(listLocalTuiProcesses()).toEqual([
      { pid: 101, command: "alien-tui" },
      { pid: 104, command: "alien tui --local" },
    ]);
  });

  it("terminates stale local TUI processes with a kill fallback", async () => {
    const alive = new Set([101]);
    const signals: Array<[number, string | number]> = [];
    const controller = {
      kill: vi.fn((pid: number, signal: string | number) => {
        signals.push([pid, signal]);
        if (signal === "SIGKILL") {
          alive.delete(pid);
          return true;
        }
        if (signal === 0) {
          if (alive.has(pid)) {
            return true;
          }
          throw new Error("gone");
        }
        return true;
      }),
    };

    await expect(
      terminateLocalTuiProcesses({
        processes: [{ pid: 101, command: "alien-tui" }],
        controller,
        graceMs: 0,
      }),
    ).resolves.toEqual({ stopped: [101], failed: [] });
    expect(signals).toEqual([
      [101, "SIGTERM"],
      [101, 0],
      [101, "SIGKILL"],
      [101, 0],
    ]);
  });

  it("warns and repairs local TUI pressure when WhatsApp is enabled and the gateway is degraded", async () => {
    const terminate = vi.fn().mockResolvedValue({ stopped: [101], failed: [] });
    const cfg = { channels: { whatsapp: { enabled: true } } } as AlienConfig;

    await noteWhatsappResponsivenessHealth({
      cfg,
      status: {
        eventLoop: {
          degraded: true,
          reasons: ["event_loop_delay"],
          intervalMs: 30_000,
          delayP99Ms: 42,
          delayMaxMs: 12_000,
          utilization: 0.3,
          cpuCoreRatio: 0.4,
        },
      },
      shouldRepair: true,
      listLocalTuiProcesses: () => [{ pid: 101, command: "alien-tui" }],
      terminateLocalTuiProcesses: terminate,
    });

    expect(terminate).toHaveBeenCalledWith({
      processes: [{ pid: 101, command: "alien-tui" }],
    });
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining("Stopped local TUI clients: 101"),
      "WhatsApp responsiveness",
    );
  });

  it("does not treat generic model routing as a WhatsApp-only issue", async () => {
    const cfg = {
      channels: { whatsapp: { enabled: true } },
      agents: { defaults: { model: { primary: "openai-codex/gpt-5.5" } } },
    } as AlienConfig;

    await noteWhatsappResponsivenessHealth({
      cfg,
      status: {
        eventLoop: {
          degraded: false,
          reasons: [],
          intervalMs: 1,
          delayP99Ms: 0,
          delayMaxMs: 0,
          utilization: 0,
          cpuCoreRatio: 0,
        },
      },
      shouldRepair: true,
      listLocalTuiProcesses: () => [],
    });

    expect(noteMock).not.toHaveBeenCalled();
  });
});
