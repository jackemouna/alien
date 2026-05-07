import process from "node:process";
import { CommanderError } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCli, shouldStartProxyForCli } from "./run-main.js";

const tryRouteCliMock = vi.hoisted(() => vi.fn());
const loadDotEnvMock = vi.hoisted(() => vi.fn());
const normalizeEnvMock = vi.hoisted(() => vi.fn());
const ensurePathMock = vi.hoisted(() => vi.fn());
const assertRuntimeMock = vi.hoisted(() => vi.fn());
const closeActiveMemorySearchManagersMock = vi.hoisted(() => vi.fn(async () => {}));
const hasMemoryRuntimeMock = vi.hoisted(() => vi.fn(() => false));
const ensureTaskRegistryReadyMock = vi.hoisted(() => vi.fn());
const startTaskRegistryMaintenanceMock = vi.hoisted(() => vi.fn());
const outputRootHelpMock = vi.hoisted(() => vi.fn());
const outputPrecomputedRootHelpTextMock = vi.hoisted(() => vi.fn(() => false));
const outputPrecomputedBrowserHelpTextMock = vi.hoisted(() => vi.fn(() => false));
const buildProgramMock = vi.hoisted(() => vi.fn());
const getProgramContextMock = vi.hoisted(() => vi.fn(() => null));
const registerCoreCliByNameMock = vi.hoisted(() => vi.fn());
const registerSubCliByNameMock = vi.hoisted(() => vi.fn());
const registerPluginCliCommandsFromValidatedConfigMock = vi.hoisted(() => vi.fn(async () => ({})));
const resolvePluginCliRootOwnerIdsMock = vi.hoisted(() => vi.fn());
const restoreTerminalStateMock = vi.hoisted(() => vi.fn());
const hasEnvHttpProxyAgentConfiguredMock = vi.hoisted(() => vi.fn(() => false));
const ensureGlobalUndiciEnvProxyDispatcherMock = vi.hoisted(() => vi.fn());
const runCrestodianMock = vi.hoisted(() => vi.fn(async () => {}));
const commanderParseAsyncMock = vi.hoisted(() => vi.fn(async () => {}));
const addGatewayRunCommandMock = vi.hoisted(() => vi.fn((command: unknown) => command));
const emitCliBannerMock = vi.hoisted(() => vi.fn());
const progressDoneMock = vi.hoisted(() => vi.fn());
const createCliProgressMock = vi.hoisted(() =>
  vi.fn(() => ({
    done: progressDoneMock,
  })),
);
const loadConfigMock = vi.hoisted(() => vi.fn(() => ({})));
const startProxyMock = vi.hoisted(() =>
  vi.fn<(config: unknown) => Promise<unknown>>(async () => null),
);
const stopProxyMock = vi.hoisted(() => vi.fn<(handle: unknown) => Promise<void>>(async () => {}));
const maybeRunCliInContainerMock = vi.hoisted(() =>
  vi.fn<
    (argv: string[]) => { handled: true; exitCode: number } | { handled: false; argv: string[] }
  >((argv: string[]) => ({ handled: false, argv })),
);

vi.mock("commander", () => {
  class MockCommanderError extends Error {
    exitCode: number;
    code: string;

    constructor(exitCode: number, code: string, message: string) {
      super(message);
      this.exitCode = exitCode;
      this.code = code;
    }
  }

  class MockCommand {
    name = vi.fn(() => this);
    enablePositionalOptions = vi.fn(() => this);
    option = vi.fn(() => this);
    exitOverride = vi.fn(() => this);
    description = vi.fn(() => this);
    command = vi.fn(() => new MockCommand());
    parseAsync = commanderParseAsyncMock;
  }

  return {
    Command: MockCommand,
    CommanderError: MockCommanderError,
  };
});

vi.mock("./route.js", () => ({
  tryRouteCli: tryRouteCliMock,
}));

vi.mock("./gateway-cli/run.js", () => ({
  addGatewayRunCommand: addGatewayRunCommandMock,
}));

vi.mock("../version.js", () => ({
  VERSION: "9.9.9-test",
}));

vi.mock("./banner.js", () => ({
  emitCliBanner: emitCliBannerMock,
}));

vi.mock("./container-target.js", () => ({
  maybeRunCliInContainer: maybeRunCliInContainerMock,
  parseCliContainerArgs: (argv: string[]) => ({ ok: true, container: null, argv }),
}));

vi.mock("./dotenv.js", () => ({
  loadCliDotEnv: loadDotEnvMock,
}));

vi.mock("../infra/env.js", () => ({
  isTruthyEnvValue: (value?: string) =>
    typeof value === "string" && ["1", "on", "true", "yes"].includes(value.trim().toLowerCase()),
  normalizeEnv: normalizeEnvMock,
}));

vi.mock("../infra/path-env.js", () => ({
  ensureAlienCliOnPath: ensurePathMock,
}));

vi.mock("../infra/runtime-guard.js", () => ({
  assertSupportedRuntime: assertRuntimeMock,
}));

vi.mock("../plugins/memory-runtime.js", () => ({
  closeActiveMemorySearchManagers: closeActiveMemorySearchManagersMock,
}));

vi.mock("../plugins/memory-state.js", () => ({
  hasMemoryRuntime: hasMemoryRuntimeMock,
}));

vi.mock("../tasks/task-registry.js", () => ({
  ensureTaskRegistryReady: ensureTaskRegistryReadyMock,
}));

vi.mock("../tasks/task-registry.maintenance.js", () => ({
  startTaskRegistryMaintenance: startTaskRegistryMaintenanceMock,
}));

vi.mock("./program/root-help.js", () => ({
  outputRootHelp: outputRootHelpMock,
}));

vi.mock("./root-help-metadata.js", () => ({
  outputPrecomputedBrowserHelpText: outputPrecomputedBrowserHelpTextMock,
  outputPrecomputedRootHelpText: outputPrecomputedRootHelpTextMock,
}));

vi.mock("./program.js", () => ({
  buildProgram: buildProgramMock,
}));

vi.mock("./program/program-context.js", () => ({
  getProgramContext: getProgramContextMock,
}));

vi.mock("./program/command-registry.js", () => ({
  registerCoreCliByName: registerCoreCliByNameMock,
}));

vi.mock("./program/register.subclis.js", () => ({
  registerSubCliByName: registerSubCliByNameMock,
}));

vi.mock("../plugins/cli.js", () => ({
  registerPluginCliCommandsFromValidatedConfig: registerPluginCliCommandsFromValidatedConfigMock,
}));

vi.mock("../plugins/cli-registry-loader.js", () => ({
  resolvePluginCliRootOwnerIds: resolvePluginCliRootOwnerIdsMock,
}));

vi.mock("../terminal/restore.js", () => ({
  restoreTerminalState: restoreTerminalStateMock,
}));

vi.mock("../infra/net/proxy-env.js", () => ({
  hasEnvHttpProxyAgentConfigured: hasEnvHttpProxyAgentConfiguredMock,
}));

vi.mock("../infra/net/undici-global-dispatcher.js", () => ({
  ensureGlobalUndiciEnvProxyDispatcher: ensureGlobalUndiciEnvProxyDispatcherMock,
}));

vi.mock("../crestodian/crestodian.js", () => ({
  runCrestodian: runCrestodianMock,
}));

vi.mock("./progress.js", () => ({
  createCliProgress: createCliProgressMock,
}));

vi.mock("../config/io.js", () => ({
  readBestEffortConfig: loadConfigMock,
}));

vi.mock("../infra/net/proxy/proxy-lifecycle.js", () => ({
  startProxy: startProxyMock,
  stopProxy: stopProxyMock,
}));

function makeProxyHandle() {
  return {
    proxyUrl: "http://127.0.0.1:19876",
    injectedProxyUrl: "http://127.0.0.1:19876",
    envSnapshot: {
      http_proxy: undefined,
      https_proxy: undefined,
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      GLOBAL_AGENT_HTTP_PROXY: undefined,
      GLOBAL_AGENT_HTTPS_PROXY: undefined,
      GLOBAL_AGENT_FORCE_GLOBAL_AGENT: undefined,
      no_proxy: undefined,
      NO_PROXY: undefined,
      GLOBAL_AGENT_NO_PROXY: undefined,
      ALIEN_PROXY_ACTIVE: undefined,
    },
    stop: vi.fn(async () => {}),
    kill: vi.fn(),
  };
}

describe("runCli exit behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasMemoryRuntimeMock.mockReturnValue(false);
    outputPrecomputedBrowserHelpTextMock.mockReturnValue(false);
    outputPrecomputedRootHelpTextMock.mockReturnValue(false);
    hasEnvHttpProxyAgentConfiguredMock.mockReturnValue(false);
    loadConfigMock.mockReturnValue({});
    startProxyMock.mockResolvedValue(null);
    stopProxyMock.mockResolvedValue(undefined);
    getProgramContextMock.mockReturnValue(null);
    resolvePluginCliRootOwnerIdsMock.mockImplementation(
      ({ primaryCommand }: { primaryCommand?: string }) =>
        primaryCommand === "googlemeet" ? ["google-meet"] : [],
    );
    delete process.env.ALIEN_DISABLE_CLI_STARTUP_HELP_FAST_PATH;
    delete process.env.ALIEN_HIDE_BANNER;
  });

  it("does not force process.exit after successful routed command", async () => {
    tryRouteCliMock.mockResolvedValueOnce(true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`unexpected process.exit(${String(code)})`);
    }) as typeof process.exit);

    await runCli(["node", "alien", "status"]);

    expect(maybeRunCliInContainerMock).toHaveBeenCalledWith(["node", "alien", "status"]);
    expect(tryRouteCliMock).toHaveBeenCalledWith(["node", "alien", "status"]);
    expect(closeActiveMemorySearchManagersMock).not.toHaveBeenCalled();
    expect(ensureTaskRegistryReadyMock).not.toHaveBeenCalled();
    expect(startTaskRegistryMaintenanceMock).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("pauses non-tty stdin after full CLI command completion", async () => {
    tryRouteCliMock.mockResolvedValueOnce(false);
    const parseAsync = vi.fn().mockResolvedValueOnce(undefined);
    buildProgramMock.mockReturnValueOnce({
      commands: [{ name: () => "channels", aliases: () => [] }],
      parseAsync,
    });
    const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    const pauseSpy = vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);

    try {
      await runCli(["node", "alien", "channels"]);

      expect(parseAsync).toHaveBeenCalledWith(["node", "alien", "channels"]);
      expect(pauseSpy).toHaveBeenCalledTimes(1);
    } finally {
      pauseSpy.mockRestore();
      if (stdinTty) {
        Object.defineProperty(process.stdin, "isTTY", stdinTty);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }
  });

  it("emits the startup banner before gateway foreground fast-path startup", async () => {
    await runCli(["node", "alien", "gateway", "--force"]);

    expect(tryRouteCliMock).not.toHaveBeenCalled();
    expect(emitCliBannerMock).toHaveBeenCalledWith("9.9.9-test", {
      argv: ["node", "alien", "gateway", "--force"],
    });
    expect(addGatewayRunCommandMock).toHaveBeenCalledTimes(2);
    expect(commanderParseAsyncMock).toHaveBeenCalledWith([
      "node",
      "alien",
      "gateway",
      "--force",
    ]);
  });

  it("honors banner suppression on the gateway foreground fast path", async () => {
    process.env.ALIEN_HIDE_BANNER = "1";

    await runCli(["node", "alien", "gateway"]);

    expect(tryRouteCliMock).not.toHaveBeenCalled();
    expect(emitCliBannerMock).not.toHaveBeenCalled();
    expect(commanderParseAsyncMock).toHaveBeenCalledWith(["node", "alien", "gateway"]);
  });

  it("renders browser help from startup metadata without building the full program", async () => {
    outputPrecomputedBrowserHelpTextMock.mockReturnValueOnce(true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`unexpected process.exit(${String(code)})`);
    }) as typeof process.exit);

    await runCli(["node", "alien", "browser", "--help"]);

    expect(maybeRunCliInContainerMock).toHaveBeenCalledWith([
      "node",
      "alien",
      "browser",
      "--help",
    ]);
    expect(tryRouteCliMock).not.toHaveBeenCalled();
    expect(outputPrecomputedBrowserHelpTextMock).toHaveBeenCalledTimes(1);
    expect(outputRootHelpMock).not.toHaveBeenCalled();
    expect(buildProgramMock).not.toHaveBeenCalled();
    expect(closeActiveMemorySearchManagersMock).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("keeps root help on the precomputed path without proxy bootstrap", async () => {
    outputPrecomputedRootHelpTextMock.mockReturnValueOnce(true);

    await runCli(["node", "alien", "--help"]);

    expect(outputPrecomputedRootHelpTextMock).toHaveBeenCalledTimes(1);
    expect(hasEnvHttpProxyAgentConfiguredMock).not.toHaveBeenCalled();
    expect(ensureGlobalUndiciEnvProxyDispatcherMock).not.toHaveBeenCalled();
    expect(runCrestodianMock).not.toHaveBeenCalled();
  });

  it("renders root help without building the full program", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`unexpected process.exit(${String(code)})`);
    }) as typeof process.exit);

    await runCli(["node", "alien", "--help"]);

    expect(maybeRunCliInContainerMock).toHaveBeenCalledWith(["node", "alien", "--help"]);
    expect(tryRouteCliMock).not.toHaveBeenCalled();
    expect(outputPrecomputedRootHelpTextMock).toHaveBeenCalledTimes(1);
    expect(outputRootHelpMock).toHaveBeenCalledTimes(1);
    expect(buildProgramMock).not.toHaveBeenCalled();
    expect(closeActiveMemorySearchManagersMock).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("does not start the managed proxy for local gateway client commands", async () => {
    tryRouteCliMock.mockResolvedValueOnce(true);

    await runCli(["node", "alien", "status"]);

    expect(startProxyMock).not.toHaveBeenCalled();
    expect(stopProxyMock).not.toHaveBeenCalled();
  });

  it.each([
    ["gateway runtime", ["node", "alien", "gateway", "run"]],
    ["bare gateway runtime", ["node", "alien", "gateway"]],
    ["node runtime", ["node", "alien", "node", "run"]],
    ["local agent runtime", ["node", "alien", "agent", "--local"]],
    ["provider inference", ["node", "alien", "infer", "web", "fetch", "https://example.com"]],
    ["model command", ["node", "alien", "models", "auth", "login", "openai"]],
    ["plugin command", ["node", "alien", "plugins", "marketplace", "list"]],
    ["skill command", ["node", "alien", "skills", "search", "browser"]],
    ["update command", ["node", "alien", "update", "check"]],
    ["channel probe", ["node", "alien", "channels", "status", "--probe"]],
    ["channel capabilities probe", ["node", "alien", "channels", "capabilities"]],
    ["directory plugin command", ["node", "alien", "directory", "peers", "list"]],
    ["message plugin command", ["node", "alien", "message", "send", "--to", "demo"]],
    ["metadata-owned plugin command", ["node", "alien", "googlemeet", "login"]],
  ])("starts managed proxy routing for %s", (_name, argv) => {
    expect(shouldStartProxyForCli(argv)).toBe(true);
  });

  it.each([
    ["root help", ["node", "alien", "--help"]],
    ["root version", ["node", "alien", "--version"]],
    ["gateway help", ["node", "alien", "gateway", "--help"]],
    ["gateway run help", ["node", "alien", "gateway", "run", "--help"]],
    ["status", ["node", "alien", "status"]],
    ["health", ["node", "alien", "health"]],
    ["gateway status", ["node", "alien", "gateway", "status"]],
    ["gateway health", ["node", "alien", "gateway", "health"]],
    ["remote agent control-plane", ["node", "alien", "agent", "run"]],
    ["chat control-plane", ["node", "alien", "chat"]],
    ["terminal control-plane", ["node", "alien", "terminal"]],
    ["config", ["node", "alien", "config", "get", "proxy.enabled"]],
    ["channels parent help", ["node", "alien", "channels"]],
    ["completion", ["node", "alien", "completion", "zsh"]],
    ["debug proxy cli", ["node", "alien", "proxy", "start"]],
    ["agents list", ["node", "alien", "agents", "list"]],
    ["models list", ["node", "alien", "models", "list"]],
    ["models status without live probe", ["node", "alien", "models", "status"]],
    ["skills check", ["node", "alien", "skills", "check"]],
    ["skills info", ["node", "alien", "skills", "info", "weather"]],
    ["skills list", ["node", "alien", "skills", "list"]],
    ["tasks list", ["node", "alien", "tasks", "list"]],
    ["legacy singular tool namespace", ["node", "alien", "tool", "image_generate"]],
    ["gateway tools namespace typo", ["node", "alien", "tools", "effective"]],
    ["migrate", ["node", "alien", "migrate"]],
  ])("skips managed proxy routing for %s", (_name, argv) => {
    expect(shouldStartProxyForCli(argv)).toBe(false);
  });

  it("starts the managed proxy for network-capable commands by default", async () => {
    tryRouteCliMock.mockResolvedValueOnce(true);

    await runCli(["node", "alien", "plugins", "marketplace", "list"]);

    expect(startProxyMock).toHaveBeenCalledWith(undefined);
  });

  it("starts the managed proxy for metadata-owned plugin commands by default", async () => {
    tryRouteCliMock.mockResolvedValueOnce(true);

    await runCli(["node", "alien", "googlemeet", "login"]);

    expect(startProxyMock).toHaveBeenCalledWith(undefined);
  });

  it("rejects unowned command roots before proxy and plugin runtime registration", async () => {
    await expect(runCli(["node", "alien", "foo"])).rejects.toThrow(
      'No built-in command or plugin CLI metadata owns "foo"',
    );

    expect(startProxyMock).not.toHaveBeenCalled();
    expect(tryRouteCliMock).not.toHaveBeenCalled();
    expect(buildProgramMock).not.toHaveBeenCalled();
    expect(registerPluginCliCommandsFromValidatedConfigMock).not.toHaveBeenCalled();
  });

  it("does not install the env proxy dispatcher for bypassed skills inspection commands", async () => {
    hasEnvHttpProxyAgentConfiguredMock.mockReturnValue(true);
    tryRouteCliMock.mockResolvedValueOnce(true);

    await runCli(["node", "alien", "skills", "check"]);

    expect(hasEnvHttpProxyAgentConfiguredMock).not.toHaveBeenCalled();
    expect(ensureGlobalUndiciEnvProxyDispatcherMock).not.toHaveBeenCalled();
  });

  it.each([
    ["auth", ["node", "alien", "auth", "--help"]],
    ["tool", ["node", "alien", "tool", "image_generate"]],
    ["tools", ["node", "alien", "tools", "effective"]],
  ])("keeps reserved %s command roots out of plugin command discovery", async (_name, argv) => {
    const parseAsync = vi.fn().mockResolvedValueOnce(undefined);
    buildProgramMock.mockReturnValueOnce({
      commands: [],
      parseAsync,
    });

    await runCli(argv);

    expect(startProxyMock).not.toHaveBeenCalled();
    expect(registerSubCliByNameMock).toHaveBeenCalledWith(expect.anything(), argv[2], argv);
    expect(registerPluginCliCommandsFromValidatedConfigMock).not.toHaveBeenCalled();
    expect(parseAsync).toHaveBeenCalledWith(argv);
  });

  it("fails protected commands when managed proxy activation fails", async () => {
    startProxyMock.mockRejectedValueOnce(new Error("proxy: enabled but no HTTP proxy URL"));

    await expect(runCli(["node", "alien", "gateway", "run"])).rejects.toThrow(
      "proxy: enabled but no HTTP proxy URL",
    );

    expect(tryRouteCliMock).not.toHaveBeenCalled();
    expect(stopProxyMock).not.toHaveBeenCalled();
  });

  it("fails protected commands when config cannot be loaded for managed proxy startup", async () => {
    loadConfigMock.mockImplementationOnce(() => {
      throw new Error("config parse failed");
    });

    await expect(runCli(["node", "alien", "gateway", "run"])).rejects.toThrow(
      "config parse failed",
    );

    expect(startProxyMock).not.toHaveBeenCalled();
    expect(tryRouteCliMock).not.toHaveBeenCalled();
  });

  it("stops the managed proxy after normal gateway runtime completion", async () => {
    const handle = makeProxyHandle();
    startProxyMock.mockResolvedValueOnce(handle);

    await runCli(["node", "alien", "gateway", "run"]);

    expect(startProxyMock).toHaveBeenCalledWith(undefined);
    expect(stopProxyMock).toHaveBeenCalledOnce();
    expect(stopProxyMock).toHaveBeenCalledWith(handle);
  });

  it("stops the managed proxy and exits after SIGINT", async () => {
    const handle = makeProxyHandle();
    startProxyMock.mockResolvedValueOnce(handle);
    let resolveRoute: (value: boolean) => void = () => {};
    tryRouteCliMock.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveRoute = resolve;
      }),
    );

    const processOnceSpy = vi.spyOn(process, "once");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number | string) => {
      void code;
      return undefined as never;
    }) as typeof process.exit);

    try {
      const runPromise = runCli(["node", "alien", "plugins", "marketplace", "list"]);
      await vi.waitFor(() => {
        expect(processOnceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      });

      const sigintHandler = processOnceSpy.mock.calls.find(([event]) => event === "SIGINT")?.[1];
      if (typeof sigintHandler !== "function") {
        throw new Error("SIGINT handler was not registered");
      }
      sigintHandler();

      await vi.waitFor(() => {
        expect(stopProxyMock).toHaveBeenCalledWith(handle);
      });
      await vi.waitFor(() => {
        expect(exitSpy).toHaveBeenCalledWith(130);
      });

      resolveRoute(true);
      await runPromise;
      expect(stopProxyMock).toHaveBeenCalledTimes(1);
    } finally {
      exitSpy.mockRestore();
      processOnceSpy.mockRestore();
    }
  });

  it("synchronously kills the managed proxy during hard process exit", async () => {
    const handle = makeProxyHandle();
    startProxyMock.mockResolvedValueOnce(handle);
    let resolveRoute: (value: boolean) => void = () => {};
    tryRouteCliMock.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveRoute = resolve;
      }),
    );

    const processOnceSpy = vi.spyOn(process, "once");
    try {
      const runPromise = runCli(["node", "alien", "plugins", "marketplace", "list"]);
      await vi.waitFor(() => {
        expect(processOnceSpy.mock.calls.filter(([event]) => event === "exit")).toHaveLength(2);
      });

      const exitHandler = processOnceSpy.mock.calls.find(([event]) => event === "exit")?.[1];
      if (typeof exitHandler !== "function") {
        throw new Error("exit handler was not registered");
      }
      exitHandler(0 as never);

      expect(handle.kill).toHaveBeenCalledWith("SIGTERM");
      resolveRoute(true);
      await runPromise;
      expect(stopProxyMock).not.toHaveBeenCalledWith(handle);
    } finally {
      processOnceSpy.mockRestore();
    }
  });

  it("bootstraps env proxy before bare Crestodian startup", async () => {
    hasEnvHttpProxyAgentConfiguredMock.mockReturnValue(true);
    const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });

    try {
      await runCli(["node", "alien"]);
    } finally {
      if (stdinTty) {
        Object.defineProperty(process.stdin, "isTTY", stdinTty);
      } else {
        delete (process.stdin as { isTTY?: boolean }).isTTY;
      }
      if (stdoutTty) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTty);
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      }
    }

    expect(ensureGlobalUndiciEnvProxyDispatcherMock).toHaveBeenCalledTimes(1);
    expect(runCrestodianMock).toHaveBeenCalledWith({ onReady: expect.any(Function) });
    expect(ensureGlobalUndiciEnvProxyDispatcherMock.mock.invocationCallOrder[0]).toBeLessThan(
      runCrestodianMock.mock.invocationCallOrder[0],
    );
  });

  it("bootstraps env proxy before modern onboard Crestodian startup", async () => {
    hasEnvHttpProxyAgentConfiguredMock.mockReturnValue(true);

    await runCli(["node", "alien", "onboard", "--modern", "--json"]);

    expect(ensureGlobalUndiciEnvProxyDispatcherMock).toHaveBeenCalledTimes(1);
    expect(runCrestodianMock).toHaveBeenCalledWith({
      message: undefined,
      yes: false,
      json: true,
      interactive: true,
    });
    expect(ensureGlobalUndiciEnvProxyDispatcherMock.mock.invocationCallOrder[0]).toBeLessThan(
      runCrestodianMock.mock.invocationCallOrder[0],
    );
  });

  it("closes memory managers when a runtime was registered", async () => {
    tryRouteCliMock.mockResolvedValueOnce(true);
    hasMemoryRuntimeMock.mockReturnValue(true);

    await runCli(["node", "alien", "status"]);

    expect(closeActiveMemorySearchManagersMock).toHaveBeenCalledTimes(1);
  });

  it("does not fail the command when memory cleanup is unavailable", async () => {
    tryRouteCliMock.mockResolvedValueOnce(true);
    hasMemoryRuntimeMock.mockImplementationOnce(() => {
      throw new Error("stale memory-state chunk");
    });

    await expect(runCli(["node", "alien", "status"])).resolves.toBeUndefined();

    expect(closeActiveMemorySearchManagersMock).not.toHaveBeenCalled();
  });

  it("returns after a handled container-target invocation", async () => {
    maybeRunCliInContainerMock.mockReturnValueOnce({ handled: true, exitCode: 0 });

    await runCli(["node", "alien", "--container", "demo", "status"]);

    expect(maybeRunCliInContainerMock).toHaveBeenCalledWith([
      "node",
      "alien",
      "--container",
      "demo",
      "status",
    ]);
    expect(loadDotEnvMock).not.toHaveBeenCalled();
    expect(tryRouteCliMock).not.toHaveBeenCalled();
    expect(closeActiveMemorySearchManagersMock).not.toHaveBeenCalled();
  });

  it("propagates a handled container-target exit code", async () => {
    const exitCode = process.exitCode;
    maybeRunCliInContainerMock.mockReturnValueOnce({ handled: true, exitCode: 7 });

    await runCli(["node", "alien", "--container", "demo", "status"]);

    expect(process.exitCode).toBe(7);
    process.exitCode = exitCode;
  });

  it("swallows Commander parse exits after recording the exit code", async () => {
    const exitCode = process.exitCode;
    buildProgramMock.mockReturnValueOnce({
      commands: [{ name: () => "status" }],
      parseAsync: vi
        .fn()
        .mockRejectedValueOnce(
          new CommanderError(1, "commander.excessArguments", "too many arguments for 'status'"),
        ),
    });

    await expect(runCli(["node", "alien", "status"])).resolves.toBeUndefined();

    expect(registerSubCliByNameMock).toHaveBeenCalledWith(expect.anything(), "status", [
      "node",
      "alien",
      "status",
    ]);
    expect(process.exitCode).toBe(1);
    process.exitCode = exitCode;
  });

  it("loads the real primary command before rendering command help", async () => {
    buildProgramMock.mockReturnValueOnce({
      commands: [{ name: () => "doctor" }],
      parseAsync: vi.fn().mockResolvedValueOnce(undefined),
    });
    const ctx = { programVersion: "0.0.0-test" };
    getProgramContextMock.mockReturnValueOnce(ctx as never);

    await runCli(["node", "alien", "doctor", "--help"]);

    expect(registerCoreCliByNameMock).toHaveBeenCalledWith(expect.anything(), ctx, "doctor", [
      "node",
      "alien",
      "doctor",
      "--help",
    ]);
    expect(registerSubCliByNameMock).toHaveBeenCalledWith(expect.anything(), "doctor", [
      "node",
      "alien",
      "doctor",
      "--help",
    ]);
  });

  it("restores terminal state before uncaught CLI exits", async () => {
    buildProgramMock.mockReturnValueOnce({
      commands: [{ name: () => "status" }],
      parseAsync: vi.fn().mockResolvedValueOnce(undefined),
    });

    const processOnSpy = vi.spyOn(process, "on");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as typeof process.exit);

    await runCli(["node", "alien", "status"]);

    const handler = processOnSpy.mock.calls.find(([event]) => event === "uncaughtException")?.[1];
    expect(typeof handler).toBe("function");

    try {
      expect(() => (handler as (error: unknown) => void)(new Error("boom"))).toThrow(
        "process.exit(1)",
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[alien] Uncaught exception:",
        expect.stringContaining("boom"),
      );
      expect(restoreTerminalStateMock).toHaveBeenCalledWith("uncaught exception", {
        resumeStdinIfPaused: false,
      });
    } finally {
      if (typeof handler === "function") {
        process.off("uncaughtException", handler);
      }
      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });

  it("does not exit for transient uncaught CLI exceptions", async () => {
    buildProgramMock.mockReturnValueOnce({
      commands: [{ name: () => "status" }],
      parseAsync: vi.fn().mockResolvedValueOnce(undefined),
    });

    const processOnSpy = vi.spyOn(process, "on");
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as typeof process.exit);

    await runCli(["node", "alien", "status"]);

    const handler = processOnSpy.mock.calls.find(([event]) => event === "uncaughtException")?.[1];
    expect(typeof handler).toBe("function");

    try {
      const hostUnreachable = Object.assign(new Error("connect EHOSTUNREACH 149.154.167.220:443"), {
        code: "EHOSTUNREACH",
      });
      expect(() => (handler as (error: unknown) => void)(hostUnreachable)).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[alien] Non-fatal uncaught exception (continuing):",
        expect.stringContaining("EHOSTUNREACH"),
      );
      expect(restoreTerminalStateMock).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      if (typeof handler === "function") {
        process.off("uncaughtException", handler);
      }
      consoleWarnSpy.mockRestore();
      exitSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
