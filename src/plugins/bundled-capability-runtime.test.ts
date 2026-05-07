import { describe, expect, it } from "vitest";
import { buildVitestCapabilityShimAliasMap } from "./bundled-capability-runtime.js";

describe("buildVitestCapabilityShimAliasMap", () => {
  it("keeps scoped and unscoped capability shim aliases aligned", () => {
    const aliasMap = buildVitestCapabilityShimAliasMap();

    expect(aliasMap["alien/plugin-sdk/config-runtime"]).toBe(
      aliasMap["@alien/plugin-sdk/config-runtime"],
    );
    expect(aliasMap["alien/plugin-sdk/media-runtime"]).toBe(
      aliasMap["@alien/plugin-sdk/media-runtime"],
    );
    expect(aliasMap["alien/plugin-sdk/provider-onboard"]).toBe(
      aliasMap["@alien/plugin-sdk/provider-onboard"],
    );
    expect(aliasMap["alien/plugin-sdk/speech-core"]).toBe(
      aliasMap["@alien/plugin-sdk/speech-core"],
    );
  });
});
