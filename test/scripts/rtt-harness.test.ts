import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendJsonl,
  buildRttResult,
  buildRunId,
  createHarnessEnv,
  extractRtt,
  readTelegramSummary,
  safeRunLabel,
  validateAlienPackageSpec,
} from "../../scripts/lib/rtt-harness.ts";
import { __testing as cliTesting } from "../../scripts/rtt.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(TEST_DIR, "../fixtures/telegram-qa-summary-rtt.json");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("RTT harness", () => {
  it("validates Alien package specs", () => {
    expect(validateAlienPackageSpec("alien@main")).toBe("alien@main");
    expect(validateAlienPackageSpec("alien@alpha")).toBe("alien@alpha");
    expect(validateAlienPackageSpec("alien@beta")).toBe("alien@beta");
    expect(validateAlienPackageSpec("alien@latest")).toBe("alien@latest");
    expect(validateAlienPackageSpec("alien@2026.4.30")).toBe("alien@2026.4.30");
    expect(validateAlienPackageSpec("alien@2026.4.30-beta.2")).toBe(
      "alien@2026.4.30-beta.2",
    );
    expect(validateAlienPackageSpec("alien@2026.4.30-alpha.2")).toBe(
      "alien@2026.4.30-alpha.2",
    );

    expect(() => validateAlienPackageSpec("@alien/alien@beta")).toThrow(
      /Package spec must be/,
    );
    expect(() => validateAlienPackageSpec("alien@next")).toThrow(/Package spec must be/);
  });

  it("builds stable run labels", () => {
    expect(safeRunLabel("alien@beta")).toBe("alien_beta");
    expect(
      buildRunId({
        now: new Date("2026-05-01T03:04:05.678Z"),
        spec: "alien@beta",
        index: 1,
      }),
    ).toBe("2026-05-01T030405678Z-alien_beta-2");
  });

  it("constructs harness env without dropping caller env", () => {
    const env = createHarnessEnv({
      baseEnv: {
        ALIEN_QA_TELEGRAM_GROUP_ID: "-100123",
        ALIEN_NPM_TELEGRAM_FAST: "0",
      },
      providerMode: "mock-openai",
      rawOutputDir: ".artifacts/rtt/run/raw",
      samples: 20,
      sampleTimeoutMs: 30_000,
      scenarios: ["telegram-mentioned-message-reply"],
      spec: "alien@beta",
      timeoutMs: 180_000,
      version: "2026.4.30-beta.1",
    });

    expect(env.ALIEN_QA_TELEGRAM_GROUP_ID).toBe("-100123");
    expect(env.ALIEN_NPM_TELEGRAM_PACKAGE_SPEC).toBe("alien@beta");
    expect(env.ALIEN_NPM_TELEGRAM_PACKAGE_LABEL).toBe("alien@beta (2026.4.30-beta.1)");
    expect(env.ALIEN_NPM_TELEGRAM_PROVIDER_MODE).toBe("mock-openai");
    expect(env.ALIEN_NPM_TELEGRAM_SCENARIOS).toBe("telegram-mentioned-message-reply");
    expect(env.ALIEN_NPM_TELEGRAM_OUTPUT_DIR).toBe(".artifacts/rtt/run/raw");
    expect(env.ALIEN_NPM_TELEGRAM_FAST).toBe("0");
    expect(env.ALIEN_NPM_TELEGRAM_WARM_SAMPLES).toBe("20");
    expect(env.ALIEN_NPM_TELEGRAM_SAMPLE_TIMEOUT_MS).toBe("30000");
    expect(env.ALIEN_QA_TELEGRAM_CANARY_TIMEOUT_MS).toBe("180000");
    expect(env.ALIEN_QA_TELEGRAM_SCENARIO_TIMEOUT_MS).toBe("180000");
  });

  it("extracts RTT values from Telegram QA summaries", async () => {
    const summary = await readTelegramSummary(FIXTURE_PATH);
    expect(extractRtt(summary)).toEqual({
      canaryMs: 1234,
      mentionReplyMs: 5000,
      warmSamples: [4000, 5000, 7000],
      avgMs: 5333,
      p50Ms: 5000,
      p95Ms: 7000,
      maxMs: 7000,
      failedSamples: 0,
    });
  });

  it("builds normalized result JSON", async () => {
    const summary = await readTelegramSummary(FIXTURE_PATH);
    const result = buildRttResult({
      artifacts: {
        rawObservedMessagesPath: "runs/run/raw/telegram-qa-observed-messages.json",
        rawReportPath: "runs/run/raw/telegram-qa-report.md",
        rawSummaryPath: "runs/run/raw/telegram-qa-summary.json",
        resultPath: "runs/run/result.json",
      },
      finishedAt: new Date("2026-05-01T00:00:12.000Z"),
      providerMode: "mock-openai",
      rawSummary: summary,
      runId: "run",
      scenarios: ["telegram-mentioned-message-reply"],
      spec: "alien@beta",
      startedAt: new Date("2026-05-01T00:00:00.000Z"),
      version: "2026.4.30-beta.1",
    });

    expect(result).toMatchObject({
      package: { spec: "alien@beta", version: "2026.4.30-beta.1" },
      run: { durationMs: 12_000, id: "run", status: "pass" },
      mode: {
        providerMode: "mock-openai",
        scenarios: ["telegram-mentioned-message-reply"],
      },
      rtt: {
        canaryMs: 1234,
        mentionReplyMs: 5000,
        avgMs: 5333,
        p50Ms: 5000,
        p95Ms: 7000,
        maxMs: 7000,
        failedSamples: 0,
      },
    });
    expect(result.rtt.warmSamples).toEqual([4000, 5000, 7000]);
  });

  it("marks failed scenario summaries as failed results", () => {
    const result = buildRttResult({
      artifacts: {
        rawObservedMessagesPath: "runs/run/raw/telegram-qa-observed-messages.json",
        rawReportPath: "runs/run/raw/telegram-qa-report.md",
        rawSummaryPath: "runs/run/raw/telegram-qa-summary.json",
        resultPath: "runs/run/result.json",
      },
      finishedAt: new Date("2026-05-01T00:00:12.000Z"),
      providerMode: "mock-openai",
      rawSummary: {
        scenarios: [
          { id: "telegram-canary", rttMs: 5948, status: "pass" },
          { id: "telegram-mentioned-message-reply", status: "fail" },
        ],
      },
      runId: "run",
      scenarios: ["telegram-mentioned-message-reply"],
      spec: "alien@latest",
      startedAt: new Date("2026-05-01T00:00:00.000Z"),
      version: "2026.4.29",
    });

    expect(result.run.status).toBe("fail");
    expect(result.rtt).toEqual({ canaryMs: 5948, mentionReplyMs: undefined });
  });

  it("appends JSONL rows", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "alien-rtt-test-"));
    tempDirs.push(tempDir);
    const jsonlPath = path.join(tempDir, "data/rtt.jsonl");
    await appendJsonl(jsonlPath, { run: 1 });
    await appendJsonl(jsonlPath, { run: 2 });

    await expect(fs.readFile(jsonlPath, "utf8")).resolves.toBe('{"run":1}\n{"run":2}\n');
  });

  it("parses CLI options", () => {
    const parsed = cliTesting.parseArgs([
      "alien@latest",
      "--package-tgz",
      "/tmp/alien.tgz",
      "--provider",
      "live-frontier",
      "--runs",
      "3",
      "--samples",
      "5",
      "--sample-timeout-ms",
      "30000",
      "--timeout-ms",
      "240000",
      "--harness-root",
      "/tmp/alien",
      "--output",
      "/tmp/runs",
    ]);

    expect(parsed.spec).toBe("alien@latest");
    expect(parsed.options).toMatchObject({
      packageTgz: "/tmp/alien.tgz",
      providerMode: "live-frontier",
      runs: 3,
      samples: 5,
      sampleTimeoutMs: 30_000,
      harnessRoot: "/tmp/alien",
      output: "/tmp/runs",
      scenarios: ["telegram-mentioned-message-reply"],
      timeoutMs: 240_000,
    });
  });
});
