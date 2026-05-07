import type { AlienConfig } from "alien/plugin-sdk/config-types";
import type {
  AlienPluginApi,
  AlienPluginCommandDefinition,
  PluginCommandContext,
} from "alien/plugin-sdk/plugin-entry";
import { describe, expect, it } from "vitest";
import {
  getWrittenQQBotConfig,
  installCommandRuntime,
} from "../../engine/commands/slash-command-test-support.js";
import { ensurePlatformAdapter } from "../bootstrap.js";
import { registerQQBotFrameworkCommands } from "./framework-registration.js";

function createConfig(): AlienConfig {
  return {
    channels: {
      qqbot: {
        appId: "app",
        allowFrom: ["TRUSTED_OPENID"],
        streaming: false,
        accounts: {
          default: {
            allowFrom: ["TRUSTED_OPENID"],
            streaming: false,
          },
        },
      },
    },
  };
}

function registerCommands(): AlienPluginCommandDefinition[] {
  ensurePlatformAdapter();
  const commands: AlienPluginCommandDefinition[] = [];
  const api = {
    logger: {},
    registerCommand: (command: AlienPluginCommandDefinition) => {
      commands.push(command);
    },
  } as unknown as AlienPluginApi;

  registerQQBotFrameworkCommands(api);
  return commands;
}

function findCommand(
  commands: AlienPluginCommandDefinition[],
  name: string,
): AlienPluginCommandDefinition {
  const command = commands.find((entry) => entry.name === name);
  expect(command).toBeDefined();
  return command as AlienPluginCommandDefinition;
}

function createCommandContext(
  config: AlienConfig,
  from: string | undefined,
): PluginCommandContext {
  return {
    senderId: "TRUSTED_OPENID",
    channel: "qqbot",
    isAuthorizedSender: true,
    args: "on",
    commandBody: "/bot-streaming on",
    config,
    from,
    requestConversationBinding: async () => undefined,
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  } as unknown as PluginCommandContext;
}

describe("registerQQBotFrameworkCommands", () => {
  it("registers bot-streaming as an auth-gated framework command", () => {
    const command = findCommand(registerCommands(), "bot-streaming");

    expect(command.requireAuth).toBe(true);
    expect(command.channels).toEqual(["qqbot"]);
  });

  it("preserves the private-chat guard for bot-streaming on generic framework calls", async () => {
    const config = createConfig();
    const writes: AlienConfig[] = [];
    installCommandRuntime(config, writes);
    const command = findCommand(registerCommands(), "bot-streaming");

    const missingFromResult = await command.handler(createCommandContext(config, undefined));
    const nonQQBotResult = await command.handler(createCommandContext(config, "generic:dm:user"));
    const groupResult = await command.handler(
      createCommandContext(config, "qqbot:group:GROUP_OPENID"),
    );

    expect(missingFromResult).toEqual({ text: "💡 请在私聊中使用此指令" });
    expect(nonQQBotResult).toEqual({ text: "💡 请在私聊中使用此指令" });
    expect(groupResult).toEqual({ text: "💡 请在私聊中使用此指令" });
    expect(writes).toHaveLength(0);
  });

  it("allows bot-streaming on explicit QQBot private-chat framework calls", async () => {
    const config = createConfig();
    const writes: AlienConfig[] = [];
    installCommandRuntime(config, writes);
    const command = findCommand(registerCommands(), "bot-streaming");

    const result = await command.handler(createCommandContext(config, "qqbot:c2c:TRUSTED_OPENID"));

    const qqbot = getWrittenQQBotConfig(writes[0]);
    expect(result).toMatchObject({ text: expect.stringContaining("已开启") });
    expect(writes).toHaveLength(1);
    expect(qqbot?.streaming).toBe(true);
    expect(qqbot?.accounts?.default?.streaming).toBe(true);
  });
});
