import { describe, expect, it } from "vitest";
import { maybeReplyToChannelOrigin, type ChannelReplyParams } from "./channel-reply.js";
import { createTaskRecord } from "./task-state.js";
import type { TaskDraft, TaskOrigin, TaskRecord } from "./types.js";

function channelOrigin(
  overrides: Partial<Extract<TaskOrigin, { kind: "channel" }>> = {},
): TaskOrigin {
  return {
    kind: "channel",
    channel: "slack",
    accountId: "ws-abc",
    threadId: "1700000000.000100",
    authorDisplayName: "alice",
    ...overrides,
  };
}

function makeTask(origin: TaskOrigin, input: Record<string, unknown> = {}): TaskRecord {
  const draft: TaskDraft = {
    title: "draft a brief",
    description: "produce a 200-word brief",
    role: "writer",
    dependsOn: [],
    input,
  };
  return createTaskRecord({
    taskId: "t-1",
    projectId: "alpha",
    draft,
    origin,
    now: () => "2026-05-09T12:00:00.000Z",
  });
}

describe("maybeReplyToChannelOrigin", () => {
  it("skips tasks not originating from a channel", async () => {
    const task = makeTask({ kind: "operator" });
    const result = await maybeReplyToChannelOrigin(
      task,
      { status: "done", result: "ok" },
      { send: async () => {} },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-channel-task");
  });

  it("calls send with the channel and thread from the task origin", async () => {
    const task = makeTask(channelOrigin());
    let received: ChannelReplyParams | undefined;
    const result = await maybeReplyToChannelOrigin(
      task,
      { status: "done", result: "done text" },
      {
        send: async (params) => {
          received = params;
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(received).toMatchObject({
      channel: "slack",
      accountId: "ws-abc",
      threadId: "1700000000.000100",
      to: "1700000000.000100",
      text: "done text",
    });
  });

  it("prefers channelReplyTo from task.input over threadId", async () => {
    const task = makeTask(channelOrigin(), { channelReplyTo: "C-explicit" });
    let received: ChannelReplyParams | undefined;
    await maybeReplyToChannelOrigin(
      task,
      { status: "done", result: "ok" },
      { send: async (p) => void (received = p) },
    );
    expect(received?.to).toBe("C-explicit");
  });

  it("returns missing-target when neither threadId nor channelReplyTo is set", async () => {
    const origin: TaskOrigin = { kind: "channel", channel: "slack" };
    const task = makeTask(origin);
    const result = await maybeReplyToChannelOrigin(
      task,
      { status: "done", result: "ok" },
      { send: async () => {} },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing-target");
  });

  it("formats failed outcomes with the error message", async () => {
    const task = makeTask(channelOrigin());
    let received: ChannelReplyParams | undefined;
    await maybeReplyToChannelOrigin(
      task,
      { status: "failed", error: "boom" },
      { send: async (p) => void (received = p) },
    );
    expect(received?.text).toMatch(/failed: boom/);
  });

  it("formats review outcomes with the awaiting-review preamble", async () => {
    const task = makeTask(channelOrigin());
    let received: ChannelReplyParams | undefined;
    await maybeReplyToChannelOrigin(
      task,
      { status: "review", result: "draft" },
      { send: async (p) => void (received = p) },
    );
    expect(received?.text).toMatch(/awaiting review/);
    expect(received?.text).toMatch(/draft/);
  });

  it("returns send-failed when the injected send throws", async () => {
    const task = makeTask(channelOrigin());
    const result = await maybeReplyToChannelOrigin(
      task,
      { status: "done", result: "ok" },
      {
        send: async () => {
          throw new Error("network");
        },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("send-failed");
      expect(result.error).toBe("network");
    }
  });
});
