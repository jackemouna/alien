import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCapabilityRuntimeLoader } from "./capability-runtime-loader.js";

describe("capability-runtime-loader", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-loader-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeModule(id: string, body: string): string {
    const sub = path.join(dir, id);
    fs.mkdirSync(sub, { recursive: true });
    const file = path.join(sub, "index.mjs");
    fs.writeFileSync(file, body, "utf8");
    return sub;
  }

  it("loads a module that exports `run` and dispatches via getCapability", async () => {
    const activeDir = writeModule(
      "echo",
      `export async function run(input) { return { echoed: input.hello }; }`,
    );
    const loader = createCapabilityRuntimeLoader();
    const loaded = await loader.loadCapability("echo", activeDir);
    expect(loaded.id).toBe("echo");
    expect(loaded.activeDir).toBe(activeDir);
    const cached = loader.getCapability("echo");
    expect(cached).toBeDefined();
    const result = (await cached!.run(
      { hello: "world" },
      {
        fetch: globalThis.fetch.bind(globalThis),
        log: () => {},
      },
    )) as { echoed: string };
    expect(result.echoed).toBe("world");
  });

  it("rejects a module that does not export `run`", async () => {
    const activeDir = writeModule("bad", `export const notRun = 1;`);
    const loader = createCapabilityRuntimeLoader();
    await expect(loader.loadCapability("bad", activeDir)).rejects.toThrow(/run/);
  });

  it("re-loads a fresh module on second loadCapability (hot-reload)", async () => {
    const activeDir = writeModule("v", `export async function run() { return { version: 1 }; }`);
    const loader = createCapabilityRuntimeLoader();
    const first = await loader.loadCapability("v", activeDir);
    const firstResult = (await first.run(
      {},
      {
        fetch: globalThis.fetch.bind(globalThis),
        log: () => {},
      },
    )) as { version: number };
    expect(firstResult.version).toBe(1);
    fs.writeFileSync(
      path.join(activeDir, "index.mjs"),
      `export async function run() { return { version: 2 }; }`,
      "utf8",
    );
    const second = await loader.loadCapability("v", activeDir);
    const secondResult = (await second.run(
      {},
      {
        fetch: globalThis.fetch.bind(globalThis),
        log: () => {},
      },
    )) as { version: number };
    expect(secondResult.version).toBe(2);
  });

  it("unloadCapability drops the cache entry and returns true", async () => {
    const activeDir = writeModule("gone", `export async function run() { return {}; }`);
    const loader = createCapabilityRuntimeLoader();
    await loader.loadCapability("gone", activeDir);
    expect(loader.getCapability("gone")).toBeDefined();
    expect(loader.unloadCapability("gone")).toBe(true);
    expect(loader.getCapability("gone")).toBeUndefined();
    expect(loader.unloadCapability("gone")).toBe(false);
  });

  it("listLoaded returns every currently-cached capability", async () => {
    const a = writeModule("a", `export async function run() {}`);
    const b = writeModule("b", `export async function run() {}`);
    const loader = createCapabilityRuntimeLoader();
    await loader.loadCapability("a", a);
    await loader.loadCapability("b", b);
    const ids = loader
      .listLoaded()
      .map((e) => e.id)
      .sort();
    expect(ids).toEqual(["a", "b"]);
  });
});
