import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "./tools/common.js";

const mocks = vi.hoisted(() => {
  const stubTool = (name: string, ownerOnly = false) =>
    ({
      name,
      label: name,
      displaySummary: name,
      description: name,
      ownerOnly,
      parameters: { type: "object", properties: {} },
      execute: vi.fn(),
    }) satisfies AnyAgentTool;

  return {
    createAlienToolsOptions: vi.fn(),
    stubTool,
  };
});

vi.mock("./alien-tools.js", () => ({
  createAlienTools: (options: unknown) => {
    mocks.createAlienToolsOptions(options);
    return [mocks.stubTool("cron", true)];
  },
}));

import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import { createAlienCodingTools } from "./pi-tools.js";

describe("createAlienCodingTools cron scope", () => {
  beforeEach(() => {
    mocks.createAlienToolsOptions.mockClear();
  });

  it("scopes the cron owner-only runtime grant to self-removal", () => {
    const tools = createAlienCodingTools({
      trigger: "cron",
      jobId: "job-current",
      senderIsOwner: false,
      ownerOnlyToolAllowlist: ["cron"],
    });

    expect(tools.map((tool) => tool.name)).toContain("cron");
    expect(mocks.createAlienToolsOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        cronSelfRemoveOnlyJobId: "job-current",
      }),
    );
  });

  it("does not scope ordinary owner cron sessions", () => {
    createAlienCodingTools({
      trigger: "cron",
      jobId: "job-current",
      senderIsOwner: true,
    });

    expect(mocks.createAlienToolsOptions).toHaveBeenCalledWith(
      expect.not.objectContaining({
        cronSelfRemoveOnlyJobId: expect.any(String),
      }),
    );
  });
});
