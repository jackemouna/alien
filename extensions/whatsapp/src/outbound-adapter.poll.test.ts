import type { AlienConfig } from "alien/plugin-sdk/config-types";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  sendPollWhatsApp: vi.fn(async () => ({ messageId: "poll-1", toJid: "1555@s.whatsapp.net" })),
  sendReactionWhatsApp: vi.fn(async () => undefined),
}));

vi.mock("alien/plugin-sdk/runtime-env", async () => {
  const actual = await vi.importActual<typeof import("alien/plugin-sdk/runtime-env")>(
    "alien/plugin-sdk/runtime-env",
  );
  return {
    ...actual,
    shouldLogVerbose: () => false,
  };
});

vi.mock("./send.js", () => ({
  sendPollWhatsApp: hoisted.sendPollWhatsApp,
  sendReactionWhatsApp: hoisted.sendReactionWhatsApp,
}));

let whatsappOutbound: typeof import("./outbound-adapter.js").whatsappOutbound;

describe("whatsappOutbound sendPoll", () => {
  beforeAll(async () => {
    ({ whatsappOutbound } = await import("./outbound-adapter.js"));
  });

  beforeEach(() => {
    hoisted.sendPollWhatsApp.mockClear();
    hoisted.sendReactionWhatsApp.mockClear();
  });

  it("threads cfg through poll send options", async () => {
    const cfg = { marker: "resolved-cfg" } as AlienConfig;
    const poll = {
      question: "Lunch?",
      options: ["Pizza", "Sushi"],
      maxSelections: 1,
    };

    const result = await whatsappOutbound.sendPoll!({
      cfg,
      to: "+1555",
      poll,
      accountId: "work",
    });

    expect(hoisted.sendPollWhatsApp).toHaveBeenCalledWith("+1555", poll, {
      verbose: false,
      accountId: "work",
      cfg,
    });
    expect(result).toEqual({
      channel: "whatsapp",
      messageId: "poll-1",
      toJid: "1555@s.whatsapp.net",
    });
  });
});
