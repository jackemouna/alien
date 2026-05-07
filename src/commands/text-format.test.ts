import { describe, expect, it } from "vitest";
import { shortenText } from "./text-format.js";

describe("shortenText", () => {
  it("returns original text when it fits", () => {
    expect(shortenText("alien", 16)).toBe("alien");
  });

  it("truncates and appends ellipsis when over limit", () => {
    expect(shortenText("alien-status-output", 10)).toBe("alien-…");
  });

  it("counts multi-byte characters correctly", () => {
    expect(shortenText("hello🙂world", 7)).toBe("hello🙂…");
  });
});
