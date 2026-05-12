import { describe, expect, it, vi } from "vitest";
import { createGmailClient } from "./client.js";
import type { GmailOAuthClientConfig, GmailTokens } from "./types.js";

const oauthConfig: GmailOAuthClientConfig = {
  clientId: "id",
  clientSecret: "secret",
  redirectUri: "http://localhost:8086/oauth2callback",
};

const freshTokens: GmailTokens = {
  accessToken: "access-token-1",
  refreshToken: "refresh-token-1",
  expiresAt: 1_700_000_000_000 + 3_600_000,
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
};

const expiredTokens: GmailTokens = { ...freshTokens, expiresAt: 0 };

function makeFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string, init: RequestInit = {}) => impl(url, init));
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const fixedNow = () => 1_700_000_000_000;

describe("createGmailClient.listInbox", () => {
  it("returns parsed messages with headers and decoded body", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
        return jsonResponse({ messages: [{ id: "m1" }] });
      }
      if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?")) {
        return jsonResponse({
          id: "m1",
          threadId: "t1",
          snippet: "Hi alice",
          labelIds: ["INBOX", "UNREAD"],
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "bob@example.com" },
              { name: "Subject", value: "Hello" },
              { name: "Date", value: "Mon, 5 May 2025 10:00:00 +0000" },
            ],
            body: { data: Buffer.from("hello world", "utf8").toString("base64url") },
          },
        });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const client = createGmailClient({
      oauthConfig,
      initialTokens: freshTokens,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: fixedNow,
    });
    const messages = await client.listInbox({ maxResults: 5 });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.id).toBe("m1");
    expect(messages[0]!.subject).toBe("Hello");
    expect(messages[0]!.from).toBe("bob@example.com");
    expect(messages[0]!.bodyText).toBe("hello world");
    expect(messages[0]!.unread).toBe(true);
  });

  it("refreshes the access token when expired before the first call", async () => {
    let refreshCount = 0;
    let listCount = 0;
    const fetchImpl = makeFetch((url, init) => {
      if (url === "https://oauth2.googleapis.com/token") {
        refreshCount += 1;
        return jsonResponse({ access_token: "refreshed", expires_in: 3600 });
      }
      if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
        listCount += 1;
        const auth = (init.headers as Headers).get?.("Authorization");
        expect(auth).toBe("Bearer refreshed");
        return jsonResponse({ messages: [] });
      }
      throw new Error(`unexpected url ${url}`);
    });
    let stored: GmailTokens | undefined;
    const client = createGmailClient({
      oauthConfig,
      initialTokens: expiredTokens,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: fixedNow,
      onTokensRefreshed: (next) => {
        stored = next;
      },
    });
    await client.listInbox();
    expect(refreshCount).toBe(1);
    expect(listCount).toBe(1);
    expect(stored?.accessToken).toBe("refreshed");
  });

  it("retries once on a 401 after refreshing", async () => {
    let listAttempt = 0;
    const fetchImpl = makeFetch((url, init) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "refreshed", expires_in: 3600 });
      }
      if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
        listAttempt += 1;
        if (listAttempt === 1) return jsonResponse({}, { status: 401 });
        const auth = (init.headers as Headers).get?.("Authorization");
        expect(auth).toBe("Bearer refreshed");
        return jsonResponse({ messages: [] });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const client = createGmailClient({
      oauthConfig,
      initialTokens: freshTokens,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: fixedNow,
    });
    await client.listInbox();
    expect(listAttempt).toBe(2);
  });
});

describe("createGmailClient.sendEmail", () => {
  it("posts a base64url-encoded RFC822 message with the threadId", async () => {
    let posted: { body: string; auth: string | null } | null = null;
    const fetchImpl = makeFetch((url, init) => {
      if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
        posted = {
          body: (init.body as string) ?? "",
          auth: (init.headers as Headers).get?.("Authorization") ?? null,
        };
        return jsonResponse({ id: "sent-1", threadId: "thread-1" });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const client = createGmailClient({
      oauthConfig,
      initialTokens: freshTokens,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: fixedNow,
    });
    const receipt = await client.sendEmail({
      to: "alice@example.com",
      subject: "Howdy",
      bodyText: "Hi there",
      threadId: "thread-1",
    });
    expect(receipt).toEqual({ id: "sent-1", threadId: "thread-1" });
    expect(posted).not.toBeNull();
    const parsed = JSON.parse(posted!.body) as { raw: string; threadId: string };
    expect(parsed.threadId).toBe("thread-1");
    const decoded = Buffer.from(
      parsed.raw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    expect(decoded).toContain("To: alice@example.com");
    expect(decoded).toContain("Subject: Howdy");
    expect(decoded).toContain("Hi there");
  });
});

describe("createGmailClient.createDraft", () => {
  it("fetches the original message and posts a threaded reply draft", async () => {
    const fetchImpl = makeFetch((url, init) => {
      if (
        url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?format=metadata")
      ) {
        return jsonResponse({
          id: "m1",
          threadId: "t1",
          payload: {
            headers: [
              { name: "Subject", value: "Original question" },
              { name: "From", value: "bob@example.com" },
              { name: "Message-ID", value: "<orig@example.com>" },
            ],
          },
        });
      }
      if (url === "https://gmail.googleapis.com/gmail/v1/users/me/drafts") {
        const body = JSON.parse((init.body as string) ?? "{}") as {
          message: { raw: string; threadId: string };
        };
        const decoded = Buffer.from(
          body.message.raw.replace(/-/g, "+").replace(/_/g, "/"),
          "base64",
        ).toString("utf8");
        expect(decoded).toContain("To: bob@example.com");
        expect(decoded).toContain("Subject: Re: Original question");
        expect(decoded).toContain("In-Reply-To: <orig@example.com>");
        expect(decoded).toContain("Here is my reply.");
        return jsonResponse({
          id: "draft-1",
          message: { id: "m2", threadId: "t1" },
        });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const client = createGmailClient({
      oauthConfig,
      initialTokens: freshTokens,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: fixedNow,
    });
    const receipt = await client.createDraft({
      inReplyToMessageId: "m1",
      bodyText: "Here is my reply.",
    });
    expect(receipt.draftId).toBe("draft-1");
    expect(receipt.threadId).toBe("t1");
  });
});
