import { describe, expect, it, vi } from "vitest";
import { connectGmailAccount } from "./connect.js";
import type { GmailOAuthClientConfig, GmailTokens } from "./types.js";

const config: GmailOAuthClientConfig = {
  clientId: "id",
  clientSecret: "secret",
  redirectUri: "http://localhost:8086/oauth2callback",
};

const goodTokenResponse = {
  access_token: "at-1",
  refresh_token: "rt-1",
  expires_in: 3600,
  scope: "https://www.googleapis.com/auth/gmail.readonly",
  token_type: "Bearer",
};

describe("connectGmailAccount", () => {
  it("walks the auth URL → callback → token exchange → persist flow", async () => {
    const presented: string[] = [];
    let stored: { email: string; tokens: GmailTokens } | null = null;
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(goodTokenResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const waitForCallback = vi.fn(async () => ({ code: "auth-code-1", state: "s" }));

    await connectGmailAccount({
      config,
      email: "alice@example.com",
      presentAuthUrl: (url) => {
        presented.push(url);
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      waitForCallback: waitForCallback as unknown as (
        ...args: never[]
      ) => Promise<{ code: string; state: string }>,
      persistTokens: (email, tokens) => {
        stored = { email, tokens };
      },
    });

    expect(presented).toHaveLength(1);
    const url = new URL(presented[0]!);
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("login_hint")).toBe("alice@example.com");
    expect(stored?.email).toBe("alice@example.com");
    expect(stored?.tokens.accessToken).toBe("at-1");
    expect(stored?.tokens.refreshToken).toBe("rt-1");
  });

  it("rejects non-localhost redirect URIs", async () => {
    await expect(
      connectGmailAccount({
        config: { ...config, redirectUri: "https://example.com/cb" },
        email: "x@y.z",
        presentAuthUrl: () => {},
      }),
    ).rejects.toThrow(/localhost/);
  });

  it("rejects an empty email", async () => {
    await expect(
      connectGmailAccount({
        config,
        email: "   ",
        presentAuthUrl: () => {},
      }),
    ).rejects.toThrow(/email is required/);
  });
});
