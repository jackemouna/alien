import { resolveChannelGroupRequireMention } from "alien/plugin-sdk/channel-policy";
import type { AlienConfig } from "alien/plugin-sdk/core";

type GoogleChatGroupContext = {
  cfg: AlienConfig;
  accountId?: string | null;
  groupId?: string | null;
};

export function resolveGoogleChatGroupRequireMention(params: GoogleChatGroupContext): boolean {
  return resolveChannelGroupRequireMention({
    cfg: params.cfg,
    channel: "googlechat",
    groupId: params.groupId,
    accountId: params.accountId,
  });
}
