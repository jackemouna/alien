import path from "node:path";

/**
 * Deny writes that target Alien's own source tree.
 *
 * The agent is invoked with `fs_write` and `edit` tools that resolve any
 * absolute path. Without a guard, a single prompt-injection inside a channel
 * message can rewrite `src/agents/sandbox/runtime-status.ts` (flipping the
 * sandbox decision), drop tools from `src/security/dangerous-tools.ts`, or
 * patch startup code. Persists across restarts and undoes every other defense.
 *
 * The guard refuses writes whose resolved absolute path lives inside the
 * Alien install root (the directory containing `alien.mjs`). Operators who
 * deliberately want to let the agent edit Alien itself can opt out with
 * `ALIEN_ALLOW_SELF_EDIT=1`.
 *
 * Audit reference: [AUDIT.md](../../AUDIT.md) H2.
 */
export type SelfEditGuardDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

const DEFAULT_OPT_OUT_ENV = "ALIEN_ALLOW_SELF_EDIT";

export type SelfEditGuardOptions = {
  /** Absolute path of the directory we want to protect (typically Alien's install root). */
  readonly installRoot: string | undefined;
  /** Env value of `ALIEN_ALLOW_SELF_EDIT` (or another override) — when "1" the guard is bypassed. */
  readonly optOutEnvValue?: string | undefined;
};

export function checkSelfEditGuard(
  targetAbsolutePath: string,
  options: SelfEditGuardOptions,
): SelfEditGuardDecision {
  if (options.optOutEnvValue === "1") {
    return { allowed: true };
  }
  const installRoot = options.installRoot;
  if (!installRoot) {
    return { allowed: true };
  }
  const target = path.resolve(targetAbsolutePath);
  const root = path.resolve(installRoot);
  if (!isPathInsideDir(target, root)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Refusing to write inside Alien's install tree (${root}). This guard prevents prompt-injection from rewriting Alien's own code (audit H2). Set ${DEFAULT_OPT_OUT_ENV}=1 to override.`,
  };
}

function isPathInsideDir(target: string, dir: string): boolean {
  if (target === dir) {
    return true;
  }
  const rel = path.relative(dir, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Resolve Alien's install root from the running CLI entry point.
 * Returns `undefined` when invoked from a context where argv[1] does not point
 * at an alien.mjs (e.g. during certain test bootstraps); the guard treats an
 * unknown root as "no protection" rather than blocking unrelated writes.
 */
export function resolveAlienInstallRoot(argv: ReadonlyArray<string>): string | undefined {
  const entry = argv[1];
  if (!entry) {
    return undefined;
  }
  const base = path.basename(entry);
  if (base !== "alien.mjs" && base !== "alien") {
    return undefined;
  }
  return path.dirname(path.resolve(entry));
}
