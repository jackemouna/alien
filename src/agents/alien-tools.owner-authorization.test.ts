import { describe, expect, it } from "vitest";
import {
  isAlienOwnerOnlyCoreToolName,
  ALIEN_OWNER_ONLY_CORE_TOOL_NAMES,
} from "./tools/owner-only-tools.js";

describe("createAlienTools owner authorization", () => {
  it("marks owner-only core tool names", () => {
    expect(ALIEN_OWNER_ONLY_CORE_TOOL_NAMES).toEqual(["cron", "gateway", "nodes"]);
    expect(isAlienOwnerOnlyCoreToolName("cron")).toBe(true);
    expect(isAlienOwnerOnlyCoreToolName("gateway")).toBe(true);
    expect(isAlienOwnerOnlyCoreToolName("nodes")).toBe(true);
  });

  it("keeps canvas non-owner-only", () => {
    expect(isAlienOwnerOnlyCoreToolName("canvas")).toBe(false);
  });
});
