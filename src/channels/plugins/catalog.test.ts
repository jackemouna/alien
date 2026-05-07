import { describe, expect, it } from "vitest";
import { getChannelPluginCatalogEntry } from "./catalog.js";

describe("channel plugin catalog", () => {
  it("keeps third-party channel ids mapped with catalog install trust", () => {
    const options = {
      workspaceDir: "/tmp/alien-channel-catalog-empty-workspace",
      env: {},
    };

    expect(getChannelPluginCatalogEntry("wecom", options)).toEqual(
      expect.objectContaining({
        id: "wecom",
        pluginId: "wecom-alien-plugin",
        trustedSourceLinkedOfficialInstall: true,
        install: expect.objectContaining({
          npmSpec: "@wecom/wecom-alien-plugin@2026.4.23",
        }),
      }),
    );
    expect(getChannelPluginCatalogEntry("yuanbao", options)).toEqual(
      expect.objectContaining({
        id: "yuanbao",
        pluginId: "alien-plugin-yuanbao",
        trustedSourceLinkedOfficialInstall: true,
        install: expect.objectContaining({
          npmSpec: "alien-plugin-yuanbao@2.11.0",
        }),
      }),
    );
  });
});
