import { describe, expect, it, vi } from "vitest";
import { buildAuthUrl, exchangeCodeForTokens, refreshAccessToken } from "./oauth.js";
import type { GmailOAuthClientConfig } from "./types.js";

const config: GmailOAuthClientConfig = {
  clientId: "client-id-abc",
  clientSecret: "client-secret-xyz",
  redirectUri: "http://localhost:8086/oauth2callback",
};

describe("buildAuthUrl", () => {
  it("includes the required Google OAuth parameters", () => {
    const url = new URL(buildAuthUrl({ config, state: "state-1" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("gmail.readonly");
    expect(scope).toContain("gmail.send");
    expect(scope).toContain("gmail.compose");
  });

  it("forwards login_hint when supplied", () => {
    const url = new URL(buildAuthUrl({ config, state: "s", loginHint: "alice@example.com" }));
    expect(url.searchParams.get("login_hint")).toBe("alice@example.com");
  });
});

describe("exchangeCodeForTokens", () => {
  it("posts code+credentials and returns parsed tokens", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: "at-1",
        refresh_token: "rt-1",
        expires_in: 3600,
        scope:
          "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
        token_type: "Bearer",
      }),
    );
    const tokens = await exchangeCodeForTokens({
      config,
      code: "auth-code",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1_700_000_000_000,
    });
    expect(tokens.accessToken).toBe("at-1");
    expect(tokens.refreshToken).toBe("rt-1");
    expect(tokens.expiresAt).toBe(1_700_000_000_000 + 3_600_000);
    expect(tokens.scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");

    const [, init] = fetchImpl.mock.calls[0]!;
    const body = (init as { body: string }).body;
    expect(body).toContain("code=auth-code");
    expect(body).toContain("client_id=client-id-abc");
    expect(body).toContain("client_secret=client-secret-xyz");
    expect(body).toContain("grant_type=authorization_code");
  });

  it("throws when Google omits refresh_token", async () => {
    const fetchImpl = async () => jsonResponse({ access_token: "at-1", expires_in: 3600 });
    await expect(
      exchangeCodeForTokens({
        config,
        code: "code",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/refresh_token/);
  });

  it("surfaces Google's error_description on failure", async () => {
    const fetchImpl = async () =>
      jsonResponse({ error: "invalid_grant", error_description: "code expired" }, { status: 400 });
    await expect(
      exchangeCodeForTokens({
        config,
        code: "code",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/code expired/);
  });
});

describe("refreshAccessToken", () => {
  it("preserves the previous refresh_token when Google does not return one", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        access_token: "at-2",
        expires_in: 1800,
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      });
    const tokens = await refreshAccessToken({
      config,
      refreshToken: "old-refresh-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1_700_000_000_000,
    });
    expect(tokens.accessToken).toBe("at-2");
    expect(tokens.refreshToken).toBe("old-refresh-token");
    expect(tokens.expiresAt).toBe(1_700_000_000_000 + 1_800_000);
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}
