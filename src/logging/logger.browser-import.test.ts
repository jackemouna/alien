import { importFreshModule } from "alien/plugin-sdk/test-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

type LoggerModule = typeof import("./logger.js");

const originalGetBuiltinModule = (
  process as NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }
).getBuiltinModule;

async function importBrowserSafeLogger(params?: {
  resolvePreferredAlienTmpDir?: ReturnType<typeof vi.fn>;
}): Promise<{
  module: LoggerModule;
  resolvePreferredAlienTmpDir: ReturnType<typeof vi.fn>;
}> {
  const resolvePreferredAlienTmpDir =
    params?.resolvePreferredAlienTmpDir ??
    vi.fn(() => {
      throw new Error("resolvePreferredAlienTmpDir should not run during browser-safe import");
    });

  vi.doMock("../infra/tmp-alien-dir.js", async () => {
    const actual = await vi.importActual<typeof import("../infra/tmp-alien-dir.js")>(
      "../infra/tmp-alien-dir.js",
    );
    return {
      ...actual,
      resolvePreferredAlienTmpDir,
    };
  });

  Object.defineProperty(process, "getBuiltinModule", {
    configurable: true,
    value: undefined,
  });

  const module = await importFreshModule<LoggerModule>(
    import.meta.url,
    "./logger.js?scope=browser-safe",
  );
  return { module, resolvePreferredAlienTmpDir };
}

describe("logging/logger browser-safe import", () => {
  afterEach(() => {
    vi.doUnmock("../infra/tmp-alien-dir.js");
    Object.defineProperty(process, "getBuiltinModule", {
      configurable: true,
      value: originalGetBuiltinModule,
    });
  });

  it("does not resolve the preferred temp dir at import time when node fs is unavailable", async () => {
    const { module, resolvePreferredAlienTmpDir } = await importBrowserSafeLogger();

    expect(resolvePreferredAlienTmpDir).not.toHaveBeenCalled();
    expect(module.DEFAULT_LOG_DIR).toBe("/tmp/alien");
    expect(module.DEFAULT_LOG_FILE).toBe("/tmp/alien/alien.log");
  });

  it("disables file logging when imported in a browser-like environment", async () => {
    const { module, resolvePreferredAlienTmpDir } = await importBrowserSafeLogger();

    expect(module.getResolvedLoggerSettings()).toMatchObject({
      level: "silent",
      file: "/tmp/alien/alien.log",
    });
    expect(module.isFileLogLevelEnabled("info")).toBe(false);
    expect(() => module.getLogger().info("browser-safe")).not.toThrow();
    expect(resolvePreferredAlienTmpDir).not.toHaveBeenCalled();
  });
});
