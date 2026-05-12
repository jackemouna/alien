import { describe, expect, it, vi } from "vitest";
import { createStubLlmClient } from "../../orchestrator/llm-client.js";
import type { ProjectWorkerInput } from "../../projects/pickup-loop.js";
import { createTaskRecord } from "../../projects/task-state.js";
import type { Project, TaskDraft, TaskOrigin } from "../../projects/types.js";
import type { GmailClient } from "./client.js";
import type { GmailMessage, GmailOAuthClientConfig } from "./types.js";
import { createEmailHandlerWorker } from "./worker.js";

const oauthConfig: GmailOAuthClientConfig = {
  clientId: "id",
  clientSecret: "secret",
  redirectUri: "http://localhost:8086/oauth2callback",
};

const project: Project = {
  id: "p-1",
  name: "Inbox",
  goal: "Stay on top of email",
  owner: "tester",
  createdAt: "2026-05-09T12:00:00.000Z",
  status: "active",
  channels: [],
};

const operatorOrigin: TaskOrigin = { kind: "operator" };

function makeInput(input: Record<string, unknown>): ProjectWorkerInput {
  const draft: TaskDraft = {
    title: "email task",
    description: "...",
    role: "email-handler",
    dependsOn: [],
    input,
  };
  return {
    task: createTaskRecord({
      taskId: "t-1",
      projectId: "p-1",
      draft,
      origin: operatorOrigin,
      now: () => "2026-05-09T12:00:00.000Z",
    }),
    project,
    dependencyOutputs: {},
  };
}

function stubGmailClient(impl: Partial<GmailClient>): GmailClient {
  const fallback = () => {
    throw new Error("method not implemented in stub");
  };
  return {
    listInbox: impl.listInbox ?? (fallback as GmailClient["listInbox"]),
    getMessage: impl.getMessage ?? (fallback as GmailClient["getMessage"]),
    sendEmail: impl.sendEmail ?? (fallback as GmailClient["sendEmail"]),
    createDraft: impl.createDraft ?? (fallback as GmailClient["createDraft"]),
    currentTokens:
      impl.currentTokens ??
      (() => ({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Date.now() + 60_000,
        scopes: [],
      })),
  };
}

describe("createEmailHandlerWorker", () => {
  it("rejects an unknown action with a friendly error", async () => {
    const worker = createEmailHandlerWorker({
      oauthConfig,
      defaultEmail: "user@example.com",
      clientFactory: async () => stubGmailClient({}),
    });
    const out = await worker(makeInput({ action: "delete_everything" }));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unrecognized action/);
  });

  it("list_inbox returns stripped message summaries", async () => {
    const sample: GmailMessage[] = [
      {
        id: "m1",
        threadId: "t1",
        from: "alice@example.com",
        subject: "Howdy",
        snippet: "hello",
        bodyText: "Long body that should appear in bodyExcerpt",
        unread: true,
        labels: ["INBOX", "UNREAD"],
      },
    ];
    const listInbox = vi.fn(async () => sample);
    const worker = createEmailHandlerWorker({
      oauthConfig,
      defaultEmail: "user@example.com",
      clientFactory: async () => stubGmailClient({ listInbox }),
    });
    const out = await worker(makeInput({ action: "list_inbox", maxResults: 5 }));
    expect(out.ok).toBe(true);
    const messages = (out.result as { messages: Array<Record<string, unknown>> }).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]!).toMatchObject({
      id: "m1",
      from: "alice@example.com",
      subject: "Howdy",
      unread: true,
    });
    expect(listInbox).toHaveBeenCalledWith({ maxResults: 5 });
  });

  it("send invokes sendEmail with the right fields", async () => {
    const sendEmail = vi.fn(async () => ({ id: "s1", threadId: "t-out" }));
    const worker = createEmailHandlerWorker({
      oauthConfig,
      defaultEmail: "user@example.com",
      clientFactory: async () => stubGmailClient({ sendEmail }),
    });
    const out = await worker(
      makeInput({
        action: "send",
        to: "alice@example.com",
        subject: "Hi",
        bodyText: "Body text",
      }),
    );
    expect(out.ok).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith({
      to: "alice@example.com",
      subject: "Hi",
      bodyText: "Body text",
    });
  });

  it("send refuses when required fields are missing", async () => {
    const worker = createEmailHandlerWorker({
      oauthConfig,
      defaultEmail: "user@example.com",
      clientFactory: async () => stubGmailClient({}),
    });
    const out = await worker(makeInput({ action: "send", subject: "Hi", bodyText: "x" }));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unrecognized action/);
  });

  it("draft_reply with bodyText creates a draft and marks toReview", async () => {
    const createDraft = vi.fn(async () => ({
      draftId: "d-1",
      messageId: "m-d",
      threadId: "t-1",
    }));
    const worker = createEmailHandlerWorker({
      oauthConfig,
      defaultEmail: "user@example.com",
      clientFactory: async () => stubGmailClient({ createDraft }),
    });
    const out = await worker(
      makeInput({
        action: "draft_reply",
        inReplyToMessageId: "m1",
        bodyText: "Thanks!",
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.toReview).toBe(true);
    expect(createDraft).toHaveBeenCalledWith({
      inReplyToMessageId: "m1",
      bodyText: "Thanks!",
    });
  });

  it("draft_reply with replyPrompt uses the LLM to draft the body", async () => {
    const getMessage = vi.fn(async () => ({
      id: "m1",
      threadId: "t1",
      from: "alice@example.com",
      subject: "Meeting?",
      snippet: "Want to grab coffee?",
      bodyText: "Want to grab coffee?",
      unread: true,
      labels: [],
    }));
    const createDraft = vi.fn(async () => ({
      draftId: "d-1",
      messageId: "m-d",
      threadId: "t-1",
    }));
    const llm = createStubLlmClient(() => "Sure, let's grab coffee next Tuesday.");
    const worker = createEmailHandlerWorker({
      oauthConfig,
      defaultEmail: "user@example.com",
      llm,
      clientFactory: async () => stubGmailClient({ getMessage, createDraft }),
    });
    const out = await worker(
      makeInput({
        action: "draft_reply",
        inReplyToMessageId: "m1",
        replyPrompt: "Accept and suggest Tuesday.",
      }),
    );
    expect(out.ok).toBe(true);
    expect((out.result as { bodyText: string }).bodyText).toMatch(/coffee next Tuesday/);
  });

  it("draft_reply without bodyText or replyPrompt errors", async () => {
    const worker = createEmailHandlerWorker({
      oauthConfig,
      defaultEmail: "user@example.com",
      clientFactory: async () => stubGmailClient({}),
    });
    const out = await worker(makeInput({ action: "draft_reply", inReplyToMessageId: "m1" }));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/needs either bodyText or replyPrompt/);
  });
});
