import { describe, expect, it } from "vitest";
import {
  getOfficialExternalPluginCatalogEntry,
  listOfficialExternalPluginCatalogEntries,
  resolveOfficialExternalPluginId,
  resolveOfficialExternalPluginInstall,
} from "./official-external-plugin-catalog.js";

describe("official external plugin catalog", () => {
  it("resolves third-party channel lookup aliases to published plugin ids", () => {
    const wecomByChannel = getOfficialExternalPluginCatalogEntry("wecom");
    const wecomByPlugin = getOfficialExternalPluginCatalogEntry("wecom-alien-plugin");
    const yuanbaoByChannel = getOfficialExternalPluginCatalogEntry("yuanbao");

    expect(resolveOfficialExternalPluginId(wecomByChannel!)).toBe("wecom-alien-plugin");
    expect(resolveOfficialExternalPluginId(wecomByPlugin!)).toBe("wecom-alien-plugin");
    expect(resolveOfficialExternalPluginInstall(wecomByChannel!)?.npmSpec).toBe(
      "@wecom/wecom-alien-plugin@2026.4.23",
    );
    expect(resolveOfficialExternalPluginId(yuanbaoByChannel!)).toBe("alien-plugin-yuanbao");
    expect(resolveOfficialExternalPluginInstall(yuanbaoByChannel!)?.npmSpec).toBe(
      "alien-plugin-yuanbao@2.11.0",
    );
  });

  it("keeps official launch package specs on the production package names", () => {
    expect(
      resolveOfficialExternalPluginInstall(getOfficialExternalPluginCatalogEntry("acpx")!)?.npmSpec,
    ).toBe("@alien/acpx");
    expect(
      resolveOfficialExternalPluginInstall(getOfficialExternalPluginCatalogEntry("googlechat")!)
        ?.npmSpec,
    ).toBe("@alien/googlechat");
    expect(
      resolveOfficialExternalPluginInstall(getOfficialExternalPluginCatalogEntry("line")!)?.npmSpec,
    ).toBe("@alien/line");
  });

  it("keeps Matrix and Mattermost out of the external catalog until cutover", () => {
    const ids = new Set(
      listOfficialExternalPluginCatalogEntries()
        .map((entry) => resolveOfficialExternalPluginId(entry))
        .filter(Boolean),
    );

    expect(ids.has("matrix")).toBe(false);
    expect(ids.has("mattermost")).toBe(false);
  });
});
