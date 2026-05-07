import type { AlienConfig } from "alien/plugin-sdk/config-types";

export function createWhatsAppPollFixture() {
  const cfg = { marker: "resolved-cfg" } as AlienConfig;
  const poll = {
    question: "Lunch?",
    options: ["Pizza", "Sushi"],
    maxSelections: 1,
  };
  return {
    cfg,
    poll,
    to: "+1555",
    accountId: "work",
  };
}
