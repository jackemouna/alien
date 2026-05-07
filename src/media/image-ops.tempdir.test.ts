import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePreferredAlienTmpDir } from "../infra/tmp-alien-dir.js";
import { getImageMetadata } from "./image-ops.js";

describe("image-ops temp dir", () => {
  let createdTempDir = "";

  beforeEach(() => {
    process.env.ALIEN_IMAGE_BACKEND = "sips";
    const originalMkdtemp = fs.mkdtemp.bind(fs);
    vi.spyOn(fs, "mkdtemp").mockImplementation(async (prefix) => {
      createdTempDir = await originalMkdtemp(prefix);
      return createdTempDir;
    });
  });

  afterEach(() => {
    delete process.env.ALIEN_IMAGE_BACKEND;
    vi.restoreAllMocks();
  });

  it("creates sips temp dirs under the secured Alien tmp root", async () => {
    const secureRoot = await fs.realpath(resolvePreferredAlienTmpDir());

    await getImageMetadata(Buffer.from("image"));

    expect(fs.mkdtemp).toHaveBeenCalledTimes(1);
    const [prefix] = vi.mocked(fs.mkdtemp).mock.calls[0] ?? [];
    expect(prefix).toEqual(expect.stringMatching(/^.+alien-img-[0-9a-f-]+-$/u));
    expect(path.dirname(prefix ?? "")).toBe(secureRoot);
    expect(createdTempDir.startsWith(prefix ?? "")).toBe(true);
    await expect(fs.access(createdTempDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
