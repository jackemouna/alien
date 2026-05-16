import path from "node:path";
import { pathToFileURL } from "node:url";
import { logWarn } from "../logger.js";

/**
 * Runtime loader for activated self-coded capabilities (Phase D2).
 *
 * Activated capabilities live as ESM JavaScript at
 *   ${state-dir}/extensions-active/<id>/index.mjs
 *
 * The loader:
 *
 *   - `loadCapability(id, activeDir)` dynamically imports the module,
 *     extracts `run`, caches the handle in-process. Idempotent: a second
 *     call with the same dir re-imports (using a cache-busting URL query)
 *     so an operator-edited file picks up without restart.
 *   - `getCapability(id)` returns the cached handle or undefined.
 *   - `unloadCapability(id)` drops the cached handle. Node does not
 *     truly unload ESM modules — best we can do is drop our reference,
 *     so subsequent calls fail fast with "not loaded".
 *   - `listLoaded()` returns all currently-cached capabilities.
 *
 * Honest scope: the loaded module runs in the same process with full
 * Node.js access. Operator approval is the gate (see Phase E in the
 * activator). VM-based isolation is a separate, future hardening pass.
 */

export type CapabilityRun = (
  input: Record<string, unknown>,
  deps: CapabilityDeps,
) => Promise<unknown>;

export type CapabilityDeps = {
  /** Cross-runtime fetch — same global, scoped to deps for easier mocking. */
  readonly fetch: typeof globalThis.fetch;
  /** Structured log. Routed to the gateway logger so capability logs land in audit/log files. */
  readonly log: (level: "debug" | "info" | "warn" | "error", message: string) => void;
};

export type LoadedCapability = {
  readonly id: string;
  readonly activeDir: string;
  readonly run: CapabilityRun;
  readonly loadedAt: string;
};

export type CapabilityRuntimeLoader = {
  loadCapability(id: string, activeDir: string): Promise<LoadedCapability>;
  getCapability(id: string): LoadedCapability | undefined;
  unloadCapability(id: string): boolean;
  listLoaded(): LoadedCapability[];
};

export function createCapabilityRuntimeLoader(): CapabilityRuntimeLoader {
  const cache = new Map<string, LoadedCapability>();

  return {
    async loadCapability(id, activeDir) {
      const modulePath = path.join(activeDir, "index.mjs");
      // Cache-bust the import URL so an operator-edited index.mjs reloads
      // without requiring a process restart. The query string isn't part
      // of the module's identity for Node — fresh URL ⇒ fresh import.
      const url = `${pathToFileURL(modulePath).href}?v=${Date.now()}`;
      const mod = (await import(url)) as Record<string, unknown>;
      const runRef = mod.run;
      if (typeof runRef !== "function") {
        throw new Error(`capability "${id}" at ${modulePath} does not export a \`run\` function`);
      }
      const loaded: LoadedCapability = {
        id,
        activeDir,
        run: runRef as CapabilityRun,
        loadedAt: new Date().toISOString(),
      };
      cache.set(id, loaded);
      return loaded;
    },
    getCapability(id) {
      return cache.get(id);
    },
    unloadCapability(id) {
      return cache.delete(id);
    },
    listLoaded() {
      return [...cache.values()];
    },
  };
}

/**
 * Default deps handed to every capability invocation. Capabilities can
 * use `fetch` for HTTP and `log` for structured logging — the gateway
 * logger handles routing. Nothing else (no fs, no child_process) is
 * provided through this object; if the loaded module reaches for those
 * directly via globals it works (operator-approved trust), but the
 * convention is "use what we hand you."
 */
export function buildDefaultCapabilityDeps(): CapabilityDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    log: (level, message) => {
      if (level === "error" || level === "warn") {
        logWarn(`capability: ${message}`);
        return;
      }
      // info/debug — quiet by default; the gateway logger has its own
      // level filtering, but routing through logWarn keeps Phase D2
      // dead simple.
      logWarn(`capability(${level}): ${message}`);
    },
  };
}
