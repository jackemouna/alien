import { promises as fs, watch, type FSWatcher } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { logWarn } from "../logger.js";

/**
 * Live activity stream (SSE) at GET /v1/activity/stream. Tails
 * `${state-dir}/audit.log` and pushes each new line to subscribers as
 * a server-sent event. Loopback-only, no auth — pairs with the /activity
 * page which renders the stream in a real-time feed.
 *
 * Path note: NOT under /v1/projects/* because projects-http.ts greedy-
 * matches that prefix and the bearer-auth gate inside its per-project
 * handlers would intercept loopback GETs that don't carry the token.
 *
 * On connect:
 *   1. Send a snapshot of the last N lines so the page renders something
 *      immediately instead of blank-until-next-event.
 *   2. Start an fs.watch on the audit log file, read appended lines on
 *      each 'change' event, push them as SSE.
 *   3. Keep-alive comment line every 25s so the connection doesn't drop
 *      behind proxies / OS idle timeouts.
 *
 * Limits:
 *   - One watcher + position cursor per connected client. Simple, scales
 *     fine for the local-gateway audience (single-digit operators).
 *   - File rotation isn't handled — if you truncate audit.log mid-stream
 *     the watcher will likely produce noise; reconnect to recover. Phase
 *     E would add rotation-aware tailing.
 */

const STREAM_PATH = "/v1/activity/stream";
const SNAPSHOT_TAIL_BYTES = 32 * 1024; // last 32 KB
const KEEPALIVE_INTERVAL_MS = 25_000;

export function isAuditStreamPath(pathname: string): boolean {
  return pathname === STREAM_PATH;
}

export async function handleAuditStreamRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!isAuditStreamPath(url.pathname)) return false;
  if (!isLoopbackRequest(req)) {
    res.statusCode = 403;
    res.end();
    return true;
  }
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end();
    return true;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const auditPath = path.join(resolveStateDir(), "audit.log");

  // Snapshot: last ~32 KB so newcomers see recent context.
  let cursor = 0;
  try {
    const stat = await fs.stat(auditPath);
    cursor = stat.size;
    const start = Math.max(0, stat.size - SNAPSHOT_TAIL_BYTES);
    if (cursor > start) {
      const fh = await fs.open(auditPath, "r");
      try {
        const buf = Buffer.alloc(cursor - start);
        await fh.read(buf, 0, buf.length, start);
        const text = buf.toString("utf8");
        // Drop the partial first line if we started mid-line.
        const lines = text.split("\n").filter((l) => l.trim().length > 0);
        const firstSafe = start > 0 ? 1 : 0;
        for (let i = firstSafe; i < lines.length; i++) {
          writeEvent(res, "event", lines[i]!);
        }
      } finally {
        await fh.close();
      }
    }
  } catch (err) {
    // File may not exist yet (fresh install). That's fine — we'll just
    // wait for the first append. Don't send anything.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logWarn(
        `audit-stream: snapshot read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Tail: on each fs.watch change, read appended bytes from `cursor`,
  // split into lines, emit each.
  let watcher: FSWatcher | undefined;
  let closed = false;

  const closeStream = () => {
    if (closed) return;
    closed = true;
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
    }
    clearInterval(keepalive);
    try {
      res.end();
    } catch {
      // socket may already be torn down
    }
  };

  const keepalive = setInterval(() => {
    if (closed) return;
    try {
      // SSE comment line, ignored by the browser. Keeps the connection
      // warm through idle timeouts.
      res.write(`: keepalive ${new Date().toISOString()}\n\n`);
    } catch {
      closeStream();
    }
  }, KEEPALIVE_INTERVAL_MS);

  // If the connection drops, stop watching.
  req.on("close", closeStream);
  res.on("close", closeStream);

  try {
    watcher = watch(auditPath, async () => {
      if (closed) return;
      try {
        const stat = await fs.stat(auditPath);
        if (stat.size === cursor) return;
        if (stat.size < cursor) {
          // File shrunk — likely rotated/truncated. Reset cursor to start.
          cursor = 0;
        }
        const fh = await fs.open(auditPath, "r");
        try {
          const buf = Buffer.alloc(stat.size - cursor);
          await fh.read(buf, 0, buf.length, cursor);
          cursor = stat.size;
          const text = buf.toString("utf8");
          const lines = text.split("\n").filter((l) => l.trim().length > 0);
          for (const line of lines) {
            writeEvent(res, "event", line);
          }
        } finally {
          await fh.close();
        }
      } catch (err) {
        // Transient — file may have rotated mid-read. Don't kill the
        // stream; the next change event recovers.
        logWarn(
          `audit-stream: tail read failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
    watcher.on("error", (err) => {
      logWarn(`audit-stream: watcher error: ${err instanceof Error ? err.message : String(err)}`);
      closeStream();
    });
  } catch (err) {
    // If we couldn't set up a watcher (e.g., file doesn't exist yet),
    // poll every 2 seconds as a fallback. Audit log creation on first
    // event will be picked up.
    logWarn(
      `audit-stream: watcher setup failed, falling back to poll: ${err instanceof Error ? err.message : String(err)}`,
    );
    const poll = setInterval(async () => {
      if (closed) {
        clearInterval(poll);
        return;
      }
      try {
        const stat = await fs.stat(auditPath);
        if (stat.size === cursor) return;
        const fh = await fs.open(auditPath, "r");
        try {
          const buf = Buffer.alloc(stat.size - cursor);
          await fh.read(buf, 0, buf.length, cursor);
          cursor = stat.size;
          const text = buf.toString("utf8");
          const lines = text.split("\n").filter((l) => l.trim().length > 0);
          for (const line of lines) writeEvent(res, "event", line);
        } finally {
          await fh.close();
        }
      } catch {
        // File still doesn't exist; try again next tick.
      }
    }, 2_000);
  }

  return true;
}

function writeEvent(res: ServerResponse, name: string, dataLine: string): void {
  try {
    res.write(`event: ${name}\n`);
    res.write(`data: ${dataLine}\n\n`);
  } catch {
    // socket gone; the close handler will fire and clean up.
  }
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr.startsWith("::ffff:127.")
  );
}
