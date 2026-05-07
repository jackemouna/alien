import { vi } from "vitest";
import { installChromeUserDataDirHooks } from "./chrome-user-data-dir.test-harness.js";

const chromeUserDataDir = { dir: "/tmp/alien" };
installChromeUserDataDirHooks(chromeUserDataDir);

vi.mock("./chrome.js", () => ({
  diagnoseChromeCdp: vi.fn(async () => ({
    ok: false,
    code: "websocket_health_command_timeout",
    cdpUrl: "http://127.0.0.1:18800",
    message: "mock CDP diagnostic",
    elapsedMs: 1,
  })),
  formatChromeCdpDiagnostic: vi.fn((diagnostic: { ok: boolean; code?: string; message?: string }) =>
    diagnostic.ok
      ? "CDP diagnostic: ready."
      : `CDP diagnostic: ${diagnostic.code}; ${diagnostic.message}.`,
  ),
  isChromeCdpReady: vi.fn(async () => true),
  isChromeReachable: vi.fn(async () => true),
  launchAlienChrome: vi.fn(async () => {
    throw new Error("unexpected launch");
  }),
  resolveAlienUserDataDir: vi.fn(() => chromeUserDataDir.dir),
  stopAlienChrome: vi.fn(async () => {}),
}));
