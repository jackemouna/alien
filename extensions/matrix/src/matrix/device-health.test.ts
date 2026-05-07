import { describe, expect, it } from "vitest";
import { isAlienManagedMatrixDevice, summarizeMatrixDeviceHealth } from "./device-health.js";

describe("matrix device health", () => {
  it("detects Alien-managed device names", () => {
    expect(isAlienManagedMatrixDevice("Alien Gateway")).toBe(true);
    expect(isAlienManagedMatrixDevice("Alien Debug")).toBe(true);
    expect(isAlienManagedMatrixDevice("Element iPhone")).toBe(false);
    expect(isAlienManagedMatrixDevice(null)).toBe(false);
  });

  it("summarizes stale Alien-managed devices separately from the current device", () => {
    const summary = summarizeMatrixDeviceHealth([
      {
        deviceId: "du314Zpw3A",
        displayName: "Alien Gateway",
        current: true,
      },
      {
        deviceId: "BritdXC6iL",
        displayName: "Alien Gateway",
        current: false,
      },
      {
        deviceId: "G6NJU9cTgs",
        displayName: "Alien Debug",
        current: false,
      },
      {
        deviceId: "phone123",
        displayName: "Element iPhone",
        current: false,
      },
    ]);

    expect(summary.currentDeviceId).toBe("du314Zpw3A");
    expect(summary.currentAlienDevices).toEqual([
      expect.objectContaining({ deviceId: "du314Zpw3A" }),
    ]);
    expect(summary.staleAlienDevices).toEqual([
      expect.objectContaining({ deviceId: "BritdXC6iL" }),
      expect.objectContaining({ deviceId: "G6NJU9cTgs" }),
    ]);
  });
});
