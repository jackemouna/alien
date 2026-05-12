import { describe, expect, it } from "vitest";
import { resolveGmailOAuthClientConfig } from "./config.js";

describe("resolveGmailOAuthClientConfig", () => {
  it("returns null when env vars are unset", () => {
    const cfg = resolveGmailOAuthClientConfig({} as NodeJS.ProcessEnv);
    expect(cfg).toBeNull();
  });

  it("returns the config when env vars are set", () => {
    const cfg = resolveGmailOAuthClientConfig({
      GMAIL_OAUTH_CLIENT_ID: "client-id-123",
      GMAIL_OAUTH_CLIENT_SECRET: "client-secret-abc",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg).not.toBeNull();
    expect(cfg!.clientId).toBe("client-id-123");
    expect(cfg!.clientSecret).toBe("client-secret-abc");
    expect(cfg!.redirectUri).toBe("http://localhost:8086/oauth2callback");
  });

  it("honors a custom redirect URI from env", () => {
    const cfg = resolveGmailOAuthClientConfig({
      GMAIL_OAUTH_CLIENT_ID: "id",
      GMAIL_OAUTH_CLIENT_SECRET: "secret",
      GMAIL_OAUTH_REDIRECT_URI: "http://localhost:9999/cb",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg!.redirectUri).toBe("http://localhost:9999/cb");
  });

  it("returns null when only one of the two credentials is set", () => {
    const a = resolveGmailOAuthClientConfig({
      GMAIL_OAUTH_CLIENT_ID: "id",
    } as unknown as NodeJS.ProcessEnv);
    expect(a).toBeNull();
    const b = resolveGmailOAuthClientConfig({
      GMAIL_OAUTH_CLIENT_SECRET: "secret",
    } as unknown as NodeJS.ProcessEnv);
    expect(b).toBeNull();
  });
});
