import type { Command } from "commander";
import { resolveGmailOAuthClientConfig } from "../integrations/gmail/config.js";
import { connectGmailAccount } from "../integrations/gmail/connect.js";
import { deleteGmailTokens } from "../integrations/gmail/tokens.js";

/**
 * `alien gmail` subcommands:
 *
 *   alien gmail connect <email>
 *     Walk the operator through the Google OAuth flow and store the
 *     resulting tokens in the OS keychain.
 *
 *   alien gmail disconnect <email>
 *     Forget the keychain tokens for an account.
 */

export function registerGmailCli(program: Command): void {
  const gmail = program
    .command("gmail")
    .description("Connect Alien to your Gmail account (read inbox, send mail, draft replies)");

  gmail
    .command("connect <email>")
    .description("Authorize Alien to use the supplied Gmail address")
    .action(async (email: string) => {
      const config = resolveGmailOAuthClientConfig();
      if (!config) {
        process.stderr.write(
          [
            "Couldn't find your Google OAuth credentials.",
            "",
            "Alien doesn't ship Google credentials. Set up your own OAuth client:",
            "  1. https://console.cloud.google.com/apis/credentials → 'Create OAuth client ID'",
            "  2. Choose 'Web application' and add http://localhost:8086/oauth2callback as a redirect URI.",
            "  3. Set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET in your shell,",
            "     or store them in the OS keychain and run with ALIEN_SECRETS_FROM_KEYCHAIN=1.",
            "  4. Re-run: alien gmail connect <email>",
            "",
          ].join("\n"),
        );
        process.exitCode = 2;
        return;
      }
      process.stdout.write(`Connecting Gmail for ${email}…\n`);
      try {
        await connectGmailAccount({
          config,
          email,
          presentAuthUrl: (url) => {
            process.stdout.write(
              `\nOpen this URL in your browser and approve the access:\n\n${url}\n\n`,
            );
          },
          onProgress: (msg) => {
            process.stdout.write(`${msg}\n`);
          },
        });
        process.stdout.write(`\nDone. Tokens for ${email} stored in the OS keychain.\n`);
        process.stdout.write(
          `Tell the gateway about this account by setting GMAIL_DEFAULT_ACCOUNT=${email} ` +
            `before starting it (or supply 'account' on each email task input).\n`,
        );
      } catch (err) {
        process.stderr.write(`\nGmail connect failed: ${stringifyError(err)}\n`);
        process.exitCode = 1;
      }
    });

  gmail
    .command("disconnect <email>")
    .description("Remove the stored tokens for a Gmail account")
    .action(async (email: string) => {
      const removed = deleteGmailTokens({ email });
      if (removed) {
        process.stdout.write(`Removed tokens for ${email}.\n`);
      } else {
        process.stdout.write(`No tokens found for ${email}.\n`);
      }
    });
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
