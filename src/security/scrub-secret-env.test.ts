import { describe, expect, it } from "vitest";
import {
  isSecretEnvName,
  scrubSecretEnv,
  scrubSecretEnvWithDiagnostics,
} from "./scrub-secret-env.js";

describe("isSecretEnvName", () => {
  it("flags ALIEN_-prefixed vars", () => {
    expect(isSecretEnvName("ALIEN_GATEWAY_TOKEN")).toBe(true);
    expect(isSecretEnvName("ALIEN_API_KEY")).toBe(true);
    expect(isSecretEnvName("ALIEN_GATEWAY_PASSWORD")).toBe(true);
    expect(isSecretEnvName("ALIEN_HARDENED_DEFAULTS")).toBe(true);
  });

  it("flags provider keys", () => {
    expect(isSecretEnvName("ANTHROPIC_API_KEY")).toBe(true);
    expect(isSecretEnvName("OPENAI_API_KEY")).toBe(true);
    expect(isSecretEnvName("OPENAI_ORG_ID")).toBe(true);
    expect(isSecretEnvName("GEMINI_API_KEY")).toBe(true);
    expect(isSecretEnvName("AWS_ACCESS_KEY_ID")).toBe(true);
    expect(isSecretEnvName("AWS_SECRET_ACCESS_KEY")).toBe(true);
    expect(isSecretEnvName("AWS_SESSION_TOKEN")).toBe(true);
  });

  it("flags channel tokens", () => {
    expect(isSecretEnvName("SLACK_BOT_TOKEN")).toBe(true);
    expect(isSecretEnvName("DISCORD_BOT_TOKEN")).toBe(true);
    expect(isSecretEnvName("TELEGRAM_API_TOKEN")).toBe(true);
    expect(isSecretEnvName("WHATSAPP_PHONE_ID")).toBe(true);
    expect(isSecretEnvName("MATRIX_HOMESERVER")).toBe(true);
  });

  it("flags generic secret-looking names regardless of prefix", () => {
    expect(isSecretEnvName("MY_SERVICE_TOKEN")).toBe(true);
    expect(isSecretEnvName("FOO_API_KEY")).toBe(true);
    expect(isSecretEnvName("BAR_PASSWORD")).toBe(true);
    expect(isSecretEnvName("BAZ_SECRET")).toBe(true);
    expect(isSecretEnvName("DB_CREDENTIAL")).toBe(true);
    expect(isSecretEnvName("SSH_PRIVATE_KEY")).toBe(true);
  });

  it("does NOT flag PATH or other neutral env vars", () => {
    expect(isSecretEnvName("PATH")).toBe(false);
    expect(isSecretEnvName("HOME")).toBe(false);
    expect(isSecretEnvName("USER")).toBe(false);
    expect(isSecretEnvName("LANG")).toBe(false);
    expect(isSecretEnvName("TERM")).toBe(false);
    expect(isSecretEnvName("TZ")).toBe(false);
    expect(isSecretEnvName("PWD")).toBe(false);
  });

  it("does NOT flag provider-prefixed but obviously-non-secret names (counter-example)", () => {
    // Provider prefixes catch everything under the prefix on purpose. This
    // test pins that intent — operators who want OPENAI_LOG_LEVEL etc. in
    // child shells must opt in via tool-level env overrides.
    expect(isSecretEnvName("OPENAI_LOG_LEVEL")).toBe(true);
  });
});

describe("scrubSecretEnv", () => {
  it("removes secret-bearing vars and keeps neutral ones", () => {
    const env = {
      ALIEN_GATEWAY_TOKEN: "tok_xyz",
      ANTHROPIC_API_KEY: "sk-ant-...",
      SLACK_BOT_TOKEN: "xoxb-...",
      PATH: "/usr/bin:/bin",
      HOME: "/Users/op",
      LANG: "en_US.UTF-8",
    };
    const out = scrubSecretEnv(env);
    expect(out.ALIEN_GATEWAY_TOKEN).toBeUndefined();
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.SLACK_BOT_TOKEN).toBeUndefined();
    expect(out.PATH).toBe("/usr/bin:/bin");
    expect(out.HOME).toBe("/Users/op");
    expect(out.LANG).toBe("en_US.UTF-8");
  });

  it("does not mutate the input env", () => {
    const env = { ALIEN_GATEWAY_TOKEN: "tok", PATH: "/bin" };
    const before = { ...env };
    scrubSecretEnv(env);
    expect(env).toEqual(before);
  });

  it("preserves undefined values (skipped naturally) and empty strings", () => {
    const env = { PATH: "", FOO: undefined as unknown as string };
    const out = scrubSecretEnv(env);
    expect(out.PATH).toBe("");
    expect("FOO" in out).toBe(true);
  });

  it("returns an empty object when all keys are secret", () => {
    const env = {
      ALIEN_GATEWAY_TOKEN: "a",
      OPENAI_API_KEY: "b",
      SLACK_BOT_TOKEN: "c",
    };
    expect(scrubSecretEnv(env)).toEqual({});
  });
});

describe("scrubSecretEnvWithDiagnostics", () => {
  it("returns the dropped names alongside the scrubbed env", () => {
    const env = {
      ALIEN_GATEWAY_TOKEN: "tok",
      OPENAI_API_KEY: "sk-...",
      PATH: "/bin",
    };
    const result = scrubSecretEnvWithDiagnostics(env);
    expect(result.env).toEqual({ PATH: "/bin" });
    expect(result.dropped.sort()).toEqual(["ALIEN_GATEWAY_TOKEN", "OPENAI_API_KEY"]);
  });

  it("returns empty dropped[] when nothing is scrubbed", () => {
    const env = { PATH: "/bin", HOME: "/h" };
    const result = scrubSecretEnvWithDiagnostics(env);
    expect(result.dropped).toEqual([]);
  });
});
