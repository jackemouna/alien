import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStubLlmClient } from "../orchestrator/llm-client.js";
import {
  emitChannelInbound,
  resetChannelInboundListenersForTest,
  type ChannelInboundEvent,
} from "../plugin-sdk/channel-inbound-listener.js";
import { bindChannelInboxToProjects, routeInboundMessage } from "./channel-inbox.js";
import { listTasks, saveProject } from "./store.js";
import type { Project } from "./types.js";

const goodPlannerJson = JSON.stringify({
  summary: "single task",
  tasks: [
    {
      id: "t-1",
      title: "do the thing",
      description: "act on the inbound prompt",
      role: "writer",
      dependsOn: [],
      input: {},
      priority: "normal",
      requiresApproval: false,
    },
  ],
});

const slackEvent: ChannelInboundEvent = {
  channel: "slack",
  accountId: "ws-abc",
  from: "U123",
  fromDisplayName: "alice",
  to: "C456",
  threadId: "1700000000.000100",
  text: "draft a brief on WebAssembly",
  messageId: "1700000000.000200",
  ts: Date.now(),
};

function makeProject(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    goal: "test",
    owner: "tester",
    createdAt: "2026-05-09T12:00:00.000Z",
    status: "active",
    channels: [{ channel: "slack", accountId: "ws-abc" }],
    ...overrides,
  };
}

describe("routeInboundMessage", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-projects-inbox-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates tasks on a project bound to the inbound channel", async () => {
    saveProject(dir, makeProject("alpha"));
    const llm = createStubLlmClient(() => goodPlannerJson);
    const result = await routeInboundMessage(slackEvent, { projectsDir: dir, llm });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectId).toBe("alpha");
      expect(result.taskCount).toBe(1);
    }
    const tasks = listTasks(dir, "alpha");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.origin).toEqual({
      kind: "channel",
      channel: "slack",
      accountId: "ws-abc",
      threadId: "1700000000.000100",
      authorDisplayName: "alice",
    });
  });

  it("returns no-binding when no active project matches the channel", async () => {
    saveProject(dir, makeProject("beta", { channels: [{ channel: "discord", accountId: "x" }] }));
    const llm = createStubLlmClient(() => goodPlannerJson);
    const result = await routeInboundMessage(slackEvent, { projectsDir: dir, llm });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-binding");
    expect(listTasks(dir, "beta")).toEqual([]);
  });

  it("skips archived projects even when channel matches", async () => {
    saveProject(dir, makeProject("alpha", { status: "archived" }));
    const llm = createStubLlmClient(() => goodPlannerJson);
    const result = await routeInboundMessage(slackEvent, { projectsDir: dir, llm });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-binding");
  });

  it("matches when project binding omits accountId (wildcard)", async () => {
    saveProject(dir, makeProject("alpha", { channels: [{ channel: "slack" }] }));
    const llm = createStubLlmClient(() => goodPlannerJson);
    const result = await routeInboundMessage(slackEvent, { projectsDir: dir, llm });
    expect(result.ok).toBe(true);
  });

  it("returns planner-error when the planner output is invalid JSON", async () => {
    saveProject(dir, makeProject("alpha"));
    const llm = createStubLlmClient(() => "not json");
    const result = await routeInboundMessage(slackEvent, { projectsDir: dir, llm });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("planner-error");
  });

  it("returns empty-prompt for whitespace-only inbound text", async () => {
    saveProject(dir, makeProject("alpha"));
    const llm = createStubLlmClient(() => goodPlannerJson);
    const result = await routeInboundMessage(
      { ...slackEvent, text: "   " },
      { projectsDir: dir, llm },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty-prompt");
  });
});

describe("bindChannelInboxToProjects", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-projects-inbox-bind-"));
    resetChannelInboundListenersForTest();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    resetChannelInboundListenersForTest();
  });

  it("subscribes to channel-inbound events and creates tasks on matching projects", async () => {
    saveProject(dir, makeProject("alpha"));
    const llm = createStubLlmClient(() => goodPlannerJson);
    const errors: unknown[] = [];
    const unbind = bindChannelInboxToProjects({
      projectsDir: dir,
      llm,
      onRouteError: (err) => errors.push(err),
    });
    emitChannelInbound({
      channel: "slack",
      accountId: "ws-abc",
      from: "U1",
      to: "C1",
      threadId: "t-1",
      text: "do something",
    });
    // Listener runs async via the route; wait a microtask plus an immediate
    // turn so the persist + audit fire before we assert.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const tasks = listTasks(dir, "alpha");
    expect(tasks).toHaveLength(1);
    expect(errors).toEqual([]);
    unbind();
  });
});
