import { describe, expect, it, vi } from "vitest";
import {
  maybeRunCliInContainer,
  parseCliContainerArgs,
  resolveCliContainerTarget,
} from "./container-target.js";

describe("parseCliContainerArgs", () => {
  it("extracts a root --container flag before the command", () => {
    expect(
      parseCliContainerArgs(["node", "alien", "--container", "demo", "status", "--deep"]),
    ).toEqual({
      ok: true,
      container: "demo",
      argv: ["node", "alien", "status", "--deep"],
    });
  });

  it("accepts the equals form", () => {
    expect(parseCliContainerArgs(["node", "alien", "--container=demo", "health"])).toEqual({
      ok: true,
      container: "demo",
      argv: ["node", "alien", "health"],
    });
  });

  it("rejects a missing container value", () => {
    expect(parseCliContainerArgs(["node", "alien", "--container"])).toEqual({
      ok: false,
      error: "--container requires a value",
    });
  });

  it("does not consume an adjacent flag as the container value", () => {
    expect(
      parseCliContainerArgs(["node", "alien", "--container", "--no-color", "status"]),
    ).toEqual({
      ok: false,
      error: "--container requires a value",
    });
  });

  it("leaves argv unchanged when the flag is absent", () => {
    expect(parseCliContainerArgs(["node", "alien", "status"])).toEqual({
      ok: true,
      container: null,
      argv: ["node", "alien", "status"],
    });
  });

  it("extracts --container after the command like other root options", () => {
    expect(
      parseCliContainerArgs(["node", "alien", "status", "--container", "demo", "--deep"]),
    ).toEqual({
      ok: true,
      container: "demo",
      argv: ["node", "alien", "status", "--deep"],
    });
  });

  it("stops parsing --container after the -- terminator", () => {
    expect(
      parseCliContainerArgs([
        "node",
        "alien",
        "nodes",
        "run",
        "--",
        "docker",
        "run",
        "--container",
        "demo",
        "alpine",
      ]),
    ).toEqual({
      ok: true,
      container: null,
      argv: [
        "node",
        "alien",
        "nodes",
        "run",
        "--",
        "docker",
        "run",
        "--container",
        "demo",
        "alpine",
      ],
    });
  });
});

describe("resolveCliContainerTarget", () => {
  it("uses argv first and falls back to ALIEN_CONTAINER", () => {
    expect(
      resolveCliContainerTarget(["node", "alien", "--container", "demo", "status"], {}),
    ).toBe("demo");
    expect(resolveCliContainerTarget(["node", "alien", "status"], {})).toBeNull();
    expect(
      resolveCliContainerTarget(["node", "alien", "status"], {
        ALIEN_CONTAINER: "demo",
      } as NodeJS.ProcessEnv),
    ).toBe("demo");
  });
});

describe("maybeRunCliInContainer", () => {
  it("passes through when no container target is provided", () => {
    expect(maybeRunCliInContainer(["node", "alien", "status"], { env: {} })).toEqual({
      handled: false,
      argv: ["node", "alien", "status"],
    });
  });

  it("uses ALIEN_CONTAINER when the flag is absent", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
      });

    expect(
      maybeRunCliInContainer(["node", "alien", "status"], {
        env: { ALIEN_CONTAINER: "demo" } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toEqual({
      handled: true,
      exitCode: 0,
    });

    expect(spawnSync).toHaveBeenNthCalledWith(
      3,
      "podman",
      [
        "exec",
        "-i",
        "--env",
        "ALIEN_CONTAINER_HINT=demo",
        "--env",
        "ALIEN_CLI_CONTAINER_BYPASS=1",
        "demo",
        "alien",
        "status",
      ],
      {
        stdio: "inherit",
        env: {
          ALIEN_CONTAINER: "",
        },
      },
    );
  });

  it("clears inherited host routing and gateway env before execing into the child CLI", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
      });

    maybeRunCliInContainer(["node", "alien", "status"], {
      env: {
        ALIEN_CONTAINER: "demo",
        ALIEN_PROFILE: "work",
        ALIEN_GATEWAY_PORT: "19001",
        ALIEN_GATEWAY_URL: "ws://127.0.0.1:18789",
        ALIEN_GATEWAY_TOKEN: "token",
        ALIEN_GATEWAY_PASSWORD: "password",
      } as NodeJS.ProcessEnv,
      spawnSync,
    });

    expect(spawnSync).toHaveBeenNthCalledWith(
      3,
      "podman",
      [
        "exec",
        "-i",
        "--env",
        "ALIEN_CONTAINER_HINT=demo",
        "--env",
        "ALIEN_CLI_CONTAINER_BYPASS=1",
        "demo",
        "alien",
        "status",
      ],
      {
        stdio: "inherit",
        env: {
          ALIEN_CONTAINER: "",
        },
      },
    );
  });

  it("passes the proxy URL env fallback into the child container CLI", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
      });

    maybeRunCliInContainer(["node", "alien", "status"], {
      env: {
        ALIEN_CONTAINER: "demo",
        ALIEN_PROXY_URL: " http://proxy.internal:3128 ",
      } as NodeJS.ProcessEnv,
      spawnSync,
    });

    expect(spawnSync).toHaveBeenNthCalledWith(
      3,
      "podman",
      [
        "exec",
        "-i",
        "--env",
        "ALIEN_CONTAINER_HINT=demo",
        "--env",
        "ALIEN_CLI_CONTAINER_BYPASS=1",
        "--env",
        "ALIEN_PROXY_URL=http://proxy.internal:3128",
        "demo",
        "alien",
        "status",
      ],
      {
        stdio: "inherit",
        env: {
          ALIEN_CONTAINER: "",
          ALIEN_PROXY_URL: " http://proxy.internal:3128 ",
        },
      },
    );
  });

  it.each([
    "http://127.0.0.1:3128",
    "http://127.1:3128",
    "http://127.0.0.01:3128",
    "http://localhost.:3128",
    "http://[::1]:3128",
    "http://[::ffff:127.0.0.1]:3128",
  ])("fails before forwarding loopback proxy URL %s into a child container CLI", (proxyUrl) => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      });

    expect(() =>
      maybeRunCliInContainer(["node", "alien", "status"], {
        env: {
          ALIEN_CONTAINER: "demo",
          ALIEN_PROXY_URL: ` ${proxyUrl} `,
        } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toThrow("127.0.0.1 inside a container points at the container");

    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it("redacts proxy URL credentials and URL suffixes before rejecting loopback container proxy forwarding", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      });

    let message = "";
    try {
      maybeRunCliInContainer(["node", "alien", "status"], {
        env: {
          ALIEN_CONTAINER: "demo",
          ALIEN_PROXY_URL:
            "http://proxy-user:proxy-secret@127.1:3128?token=proxy-query-secret#proxy-fragment-secret",
        } as NodeJS.ProcessEnv,
        spawnSync,
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toContain("ALIEN_PROXY_URL=http://redacted:redacted@127.0.0.1:3128/");
    expect(message).not.toContain("proxy-user");
    expect(message).not.toContain("proxy-secret");
    expect(message).not.toContain("proxy-query-secret");
    expect(message).not.toContain("proxy-fragment-secret");
    expect(message).not.toContain("?token=");
    expect(message).not.toContain("#");
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it("allows explicitly overridden loopback proxy URL forwarding into a child container CLI", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
      });

    maybeRunCliInContainer(["node", "alien", "status"], {
      env: {
        ALIEN_CONTAINER: "demo",
        ALIEN_PROXY_URL: " http://127.0.0.1:3128 ",
        ALIEN_CONTAINER_ALLOW_LOOPBACK_PROXY_URL: "1",
      } as NodeJS.ProcessEnv,
      spawnSync,
    });

    expect(spawnSync).toHaveBeenNthCalledWith(
      3,
      "podman",
      expect.arrayContaining(["ALIEN_PROXY_URL=http://127.0.0.1:3128"]),
      expect.anything(),
    );
  });

  it("executes through podman when the named container is running", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
      });

    expect(
      maybeRunCliInContainer(["node", "alien", "--container", "demo", "status"], {
        env: {},
        spawnSync,
      }),
    ).toEqual({
      handled: true,
      exitCode: 0,
    });

    expect(spawnSync).toHaveBeenNthCalledWith(
      1,
      "podman",
      ["inspect", "--format", "{{.State.Running}}", "demo"],
      { encoding: "utf8" },
    );
    expect(spawnSync).toHaveBeenNthCalledWith(
      3,
      "podman",
      [
        "exec",
        "-i",
        "--env",
        "ALIEN_CONTAINER_HINT=demo",
        "--env",
        "ALIEN_CLI_CONTAINER_BYPASS=1",
        "demo",
        "alien",
        "status",
      ],
      {
        stdio: "inherit",
        env: { ALIEN_CONTAINER: "" },
      },
    );
  });

  it("falls back to docker when podman does not have the container", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
      });

    expect(
      maybeRunCliInContainer(["node", "alien", "--container", "demo", "health"], {
        env: { USER: "alien" } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toEqual({
      handled: true,
      exitCode: 0,
    });

    expect(spawnSync).toHaveBeenNthCalledWith(
      2,
      "docker",
      ["inspect", "--format", "{{.State.Running}}", "demo"],
      { encoding: "utf8" },
    );
    expect(spawnSync).toHaveBeenNthCalledWith(
      3,
      "docker",
      [
        "exec",
        "-i",
        "-e",
        "ALIEN_CONTAINER_HINT=demo",
        "-e",
        "ALIEN_CLI_CONTAINER_BYPASS=1",
        "demo",
        "alien",
        "health",
      ],
      {
        stdio: "inherit",
        env: { USER: "alien", ALIEN_CONTAINER: "" },
      },
    );
  });

  it("checks docker after podman and before failing", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
      });

    expect(
      maybeRunCliInContainer(["node", "alien", "--container", "demo", "status"], {
        env: { USER: "somalley" } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toEqual({
      handled: true,
      exitCode: 0,
    });

    expect(spawnSync).toHaveBeenNthCalledWith(
      1,
      "podman",
      ["inspect", "--format", "{{.State.Running}}", "demo"],
      { encoding: "utf8" },
    );
    expect(spawnSync).toHaveBeenNthCalledWith(
      2,
      "docker",
      ["inspect", "--format", "{{.State.Running}}", "demo"],
      { encoding: "utf8" },
    );
    expect(spawnSync).toHaveBeenNthCalledWith(
      3,
      "docker",
      [
        "exec",
        "-i",
        "-e",
        "ALIEN_CONTAINER_HINT=demo",
        "-e",
        "ALIEN_CLI_CONTAINER_BYPASS=1",
        "demo",
        "alien",
        "status",
      ],
      {
        stdio: "inherit",
        env: { USER: "somalley", ALIEN_CONTAINER: "" },
      },
    );
    expect(spawnSync).toHaveBeenCalledTimes(3);
  });

  it("does not try any sudo podman fallback for regular users", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      });

    expect(() =>
      maybeRunCliInContainer(["node", "alien", "--container", "demo", "status"], {
        env: { USER: "somalley" } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toThrow('No running container matched "demo" under podman or docker.');

    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(spawnSync).toHaveBeenNthCalledWith(
      1,
      "podman",
      ["inspect", "--format", "{{.State.Running}}", "demo"],
      { encoding: "utf8" },
    );
    expect(spawnSync).toHaveBeenNthCalledWith(
      2,
      "docker",
      ["inspect", "--format", "{{.State.Running}}", "demo"],
      { encoding: "utf8" },
    );
  });

  it("rejects ambiguous matches across runtimes", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      });

    expect(() =>
      maybeRunCliInContainer(["node", "alien", "--container", "demo", "status"], {
        env: { USER: "somalley" } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toThrow(
      'Container "demo" is running under multiple runtimes (podman, docker); use a unique container name.',
    );
  });

  it("allocates a tty for interactive terminal sessions", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
      });

    maybeRunCliInContainer(["node", "alien", "--container", "demo", "setup"], {
      env: {},
      spawnSync,
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });

    expect(spawnSync).toHaveBeenNthCalledWith(
      3,
      "podman",
      [
        "exec",
        "-i",
        "-t",
        "--env",
        "ALIEN_CONTAINER_HINT=demo",
        "--env",
        "ALIEN_CLI_CONTAINER_BYPASS=1",
        "demo",
        "alien",
        "setup",
      ],
      {
        stdio: "inherit",
        env: { ALIEN_CONTAINER: "" },
      },
    );
  });

  it("prefers --container over ALIEN_CONTAINER", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "true\n",
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
      });

    expect(
      maybeRunCliInContainer(["node", "alien", "--container", "flag-demo", "health"], {
        env: { ALIEN_CONTAINER: "env-demo" } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toEqual({
      handled: true,
      exitCode: 0,
    });

    expect(spawnSync).toHaveBeenNthCalledWith(
      1,
      "podman",
      ["inspect", "--format", "{{.State.Running}}", "flag-demo"],
      { encoding: "utf8" },
    );
  });

  it("throws when the named container is not running", () => {
    const spawnSync = vi.fn().mockReturnValue({
      status: 1,
      stdout: "",
    });

    expect(() =>
      maybeRunCliInContainer(["node", "alien", "--container", "demo", "status"], {
        env: {},
        spawnSync,
      }),
    ).toThrow('No running container matched "demo" under podman or docker.');
  });

  it("skips recursion when the bypass env is set", () => {
    expect(
      maybeRunCliInContainer(["node", "alien", "--container", "demo", "status"], {
        env: { ALIEN_CLI_CONTAINER_BYPASS: "1" } as NodeJS.ProcessEnv,
      }),
    ).toEqual({
      handled: false,
      argv: ["node", "alien", "--container", "demo", "status"],
    });
  });

  it("blocks updater commands from running inside the container", () => {
    const spawnSync = vi.fn().mockReturnValue({
      status: 0,
      stdout: "true\n",
    });

    expect(() =>
      maybeRunCliInContainer(["node", "alien", "--container", "demo", "update"], {
        env: {},
        spawnSync,
      }),
    ).toThrow(
      "alien update is not supported with --container; rebuild or restart the container image instead.",
    );
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("blocks update after interleaved root flags", () => {
    const spawnSync = vi.fn().mockReturnValue({
      status: 0,
      stdout: "true\n",
    });

    expect(() =>
      maybeRunCliInContainer(["node", "alien", "--container", "demo", "--no-color", "update"], {
        env: {},
        spawnSync,
      }),
    ).toThrow(
      "alien update is not supported with --container; rebuild or restart the container image instead.",
    );
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("blocks the --update shorthand from running inside the container", () => {
    const spawnSync = vi.fn().mockReturnValue({
      status: 0,
      stdout: "true\n",
    });

    expect(() =>
      maybeRunCliInContainer(["node", "alien", "--container", "demo", "--update"], {
        env: {},
        spawnSync,
      }),
    ).toThrow(
      "alien update is not supported with --container; rebuild or restart the container image instead.",
    );
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
