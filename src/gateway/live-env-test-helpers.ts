const COMMON_LIVE_ENV_NAMES = [
  "ALIEN_AGENT_RUNTIME",
  "ALIEN_CONFIG_PATH",
  "ALIEN_GATEWAY_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ALIEN_SKIP_BROWSER_CONTROL_SERVER",
  "ALIEN_SKIP_CANVAS_HOST",
  "ALIEN_SKIP_CHANNELS",
  "ALIEN_SKIP_CRON",
  "ALIEN_SKIP_GMAIL_WATCHER",
  "ALIEN_STATE_DIR",
] as const;

export type LiveEnvSnapshot = Record<string, string | undefined>;

export function snapshotLiveEnv(extraNames: readonly string[] = []): LiveEnvSnapshot {
  const snapshot: LiveEnvSnapshot = {};
  for (const name of [...COMMON_LIVE_ENV_NAMES, ...extraNames]) {
    snapshot[name] = process.env[name];
  }
  return snapshot;
}

export function restoreLiveEnv(snapshot: LiveEnvSnapshot): void {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
