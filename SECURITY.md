# Security Policy

If you believe you've found a security issue in Alien, please report it
**privately first**. This page explains how to report, what we consider a
security issue, and how the maintainers triage them.

## Reporting a vulnerability

For Alien-specific vulnerabilities, please open a private
[GitHub Security Advisory](https://github.com/jackemouna/alien/security/advisories/new)
in this repository. We will acknowledge receipt within 7 days.

**Do not open a public issue or pull request** that discloses an unpatched
vulnerability, exploit path, secret, or working proof of concept. We may
close, hide, or take down public reports that do.

If you're not sure whether something counts as a security issue, file the
private advisory anyway — we'd rather triage and decline than miss it.

## Trust model

Alien is **single-user, local-first agent infrastructure**. Each Alien runs
on a single trusted operator's machine, with their API keys, their accounts,
and their files. The threat model assumes:

- The operator is trusted.
- The operator's machine has not been independently compromised.
- The operator's keys (Anthropic, Google, Slack, etc.) are valid and theirs.

It does **not** assume:

- That arbitrary chat messages reaching the gateway can be trusted. Channel
  inbound is treated as untrusted input.
- That tools or workers operate without oversight. The hardened-defaults
  profile sandboxes tools with shell access.
- That the operator's keys remain in plaintext. The OS keychain is the
  preferred storage path; env-var fallback is opt-in.

Alien is not designed to be a shared multi-tenant boundary between adversarial
users on one gateway. If you run a single Alien for many users, you take on
that boundary yourself.

## What we treat as a vulnerability

Reports that demonstrate any of the following, with a reproducible chain on a
recent main commit, are taken as vulnerabilities:

- **Boundary bypass** — code that escapes the sandbox, the audit log, the
  OAuth scope, or the channel allowlist when the operator has not opted to
  disable them.
- **Credential disclosure** — paths that leak operator keys, tokens, or
  OAuth refresh tokens to log files, error messages, or remote endpoints.
- **Audit-log tamper without detection** — modifying past audit entries in
  a way that the existing chain verification does not catch.
- **Auth bypass on the gateway HTTP surface** — reaching authenticated
  endpoints without the configured shared-secret.
- **Remote code execution** through any path the operator did not
  explicitly authorize.

## What we do not treat as a vulnerability

These are out of scope under our trust model:

- Prompt-injection chains that influence model output **without** also
  bypassing policy, auth, or the sandbox.
- Reports that rely on running multiple hostile users through one shared
  gateway. Alien is not designed for that.
- Findings that require the operator to have already disabled the
  hardened-defaults profile or copied secrets into world-readable files.
- Scanner output without a demonstrated impact chain.

## Disclosure timeline

We aim for:

- **Acknowledgement** within 7 days.
- **Triage and severity classification** within 14 days.
- **Patch and coordinated disclosure** within 90 days of report. Lower-impact
  issues may follow a shorter or longer timeline if both sides agree.

If we cannot reach you for an extended period, we may proceed with a fix and
public disclosure once a patch is shipped.

## Supported versions

This repository's `main` branch is the only supported version while Alien is
pre-1.0. Tagged releases will get a documented support window once we cross
1.0.

## Credit

If you'd like attribution in the changelog or release notes, tell us how
you'd like to be credited when you file the advisory. We default to no
attribution unless you ask.

## Third-party code

This project incorporates third-party code preserved under the licenses
documented in [NOTICE](NOTICE). Vulnerabilities specific to those paths
may be relayed to the relevant upstream maintainers with your permission;
report-routing decisions are made on a case-by-case basis.
