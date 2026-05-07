export type MatrixManagedDeviceInfo = {
  deviceId: string;
  displayName: string | null;
  current: boolean;
};

export type MatrixDeviceHealthSummary = {
  currentDeviceId: string | null;
  staleAlienDevices: MatrixManagedDeviceInfo[];
  currentAlienDevices: MatrixManagedDeviceInfo[];
};

const ALIEN_DEVICE_NAME_PREFIX = "Alien ";

export function isAlienManagedMatrixDevice(displayName: string | null | undefined): boolean {
  return displayName?.startsWith(ALIEN_DEVICE_NAME_PREFIX) === true;
}

export function summarizeMatrixDeviceHealth(
  devices: MatrixManagedDeviceInfo[],
): MatrixDeviceHealthSummary {
  const currentDeviceId = devices.find((device) => device.current)?.deviceId ?? null;
  const openClawDevices = devices.filter((device) =>
    isAlienManagedMatrixDevice(device.displayName),
  );
  return {
    currentDeviceId,
    staleAlienDevices: openClawDevices.filter((device) => !device.current),
    currentAlienDevices: openClawDevices.filter((device) => device.current),
  };
}
