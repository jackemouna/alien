import { describe, expect, it } from "vitest";
import { resolveIrcInboundTarget } from "./monitor.js";

describe("irc monitor inbound target", () => {
  it("keeps channel target for group messages", () => {
    expect(
      resolveIrcInboundTarget({
        target: "#alien",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: true,
      target: "#alien",
      rawTarget: "#alien",
    });
  });

  it("maps DM target to sender nick and preserves raw target", () => {
    expect(
      resolveIrcInboundTarget({
        target: "alien-bot",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: false,
      target: "alice",
      rawTarget: "alien-bot",
    });
  });

  it("falls back to raw target when sender nick is empty", () => {
    expect(
      resolveIrcInboundTarget({
        target: "alien-bot",
        senderNick: " ",
      }),
    ).toEqual({
      isGroup: false,
      target: "alien-bot",
      rawTarget: "alien-bot",
    });
  });
});
