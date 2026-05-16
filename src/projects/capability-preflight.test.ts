import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPreflight } from "./capability-preflight.js";

describe("capability-preflight", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-preflight-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(filename: string, body: string): void {
    fs.writeFileSync(path.join(dir, filename), body, "utf8");
  }

  it("passes for a clean stub that exports run", async () => {
    write("index.mjs", `export async function run(input, deps) { return { ok: true }; }`);
    const r = await runPreflight(dir);
    expect(r.ok).toBe(true);
    expect(r.errorSummary).toBe("");
    expect(r.checks.find((c) => c.name === "file-exists")?.passed).toBe(true);
    expect(r.checks.find((c) => c.name === "module-imports")?.passed).toBe(true);
    expect(r.checks.find((c) => c.name === "run-export")?.passed).toBe(true);
    expect(r.checks.find((c) => c.name === "source-scan")?.passed).toBe(true);
  });

  it("fails with a clear message when index.mjs is missing", async () => {
    const r = await runPreflight(dir);
    expect(r.ok).toBe(false);
    const fileCheck = r.checks.find((c) => c.name === "file-exists");
    expect(fileCheck?.passed).toBe(false);
    expect(fileCheck?.detail).toMatch(/not found|does not exist/);
    expect(r.errorSummary).toMatch(/file-exists/);
  });

  it("fails when the module has a syntax error", async () => {
    write("index.mjs", `export async function run() { this is not js`);
    const r = await runPreflight(dir);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "module-imports")?.passed).toBe(false);
    expect(r.errorSummary).toMatch(/module-imports/);
  });

  it("fails when run is missing", async () => {
    write("index.mjs", `export const notRun = 42;`);
    const r = await runPreflight(dir);
    expect(r.ok).toBe(false);
    const runCheck = r.checks.find((c) => c.name === "run-export");
    expect(runCheck?.passed).toBe(false);
    expect(runCheck?.detail).toMatch(/missing export|got/);
  });

  it("fails when run is exported but isn't a function", async () => {
    write("index.mjs", `export const run = 42;`);
    const r = await runPreflight(dir);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "run-export")?.passed).toBe(false);
  });

  it("flags eval/Function/child_process as informational warnings (still ok)", async () => {
    write(
      "index.mjs",
      `import { exec } from "child_process";
export async function run() { eval("1+1"); return {}; }`,
    );
    const r = await runPreflight(dir);
    // run-export passed, module-imports passed (or failed, depending on Node);
    // scan finds two patterns but that's warning-only so overall ok flag
    // depends only on the hard checks. We assert the warnings surface.
    const scan = r.checks.find((c) => c.name === "source-scan");
    expect(scan?.warningOnly).toBe(true);
    expect(scan?.passed).toBe(false);
    expect(scan?.detail).toMatch(/eval/);
    expect(scan?.detail).toMatch(/child_process/);
  });

  it("source-scan failure alone doesn't gate ok", async () => {
    write(
      "index.mjs",
      `import { readFile } from "node:fs";
export async function run() { return {}; }`,
    );
    const r = await runPreflight(dir);
    // The module-imports check actually runs and resolves, run is a fn,
    // file exists. The scan warns about fs but that's warning-only.
    const scan = r.checks.find((c) => c.name === "source-scan");
    expect(scan?.passed).toBe(false);
    expect(scan?.warningOnly).toBe(true);
    expect(r.ok).toBe(true);
  });
});
