import type { Project, TaskRecord } from "../../../../src/projects/types.js";

/**
 * Pre-baked sample data shown on the Projects board when a user has zero
 * real projects. Purpose: communicate what a working board looks like
 * *before* the user spends a single token. They land, see a finished
 * project, can click a "Done" card to read a plausible output, and
 * understand the product in 10 seconds instead of 30 seconds + an API call.
 *
 * Behavior contract:
 *   - The demo is render-only. Never persisted to disk, never sent over
 *     the wire to the gateway, never mutated by user clicks. Action
 *     buttons render disabled with an explanatory title.
 *   - The demo only appears when state.projects.length === 0. As soon as
 *     the user creates a real project (template or blank), the demo
 *     disappears.
 *   - The demo project's id starts with `__demo__` so even if it
 *     accidentally leaked through to a write path, the store's id
 *     sanitizer would reject it (underscores allowed, but the prefix
 *     makes intent obvious in logs and audit entries).
 */

export const DEMO_PROJECT_ID = "__demo__-tuesday-brief";

const DEMO_CREATED_AT = "2026-05-12T07:45:00.000Z";
const DEMO_OWNER = "you";

export const DEMO_PROJECT: Project = {
  id: DEMO_PROJECT_ID,
  name: "Tuesday morning brief",
  goal: "Catch me up on Bun and WebAssembly before my 10 AM call.",
  owner: DEMO_OWNER,
  createdAt: DEMO_CREATED_AT,
  status: "active",
  channels: [],
};

const DEMO_TASKS_RAW: ReadonlyArray<{
  id: string;
  title: string;
  description: string;
  role: TaskRecord["role"];
  status: TaskRecord["status"];
  dependsOn: string[];
  startedAt?: string;
  completedAt?: string;
  output?: unknown;
  priority?: TaskRecord["priority"];
}> = [
  {
    id: "research-bun",
    title: "Research Bun",
    description: "Find 5–6 concrete facts about the current Bun release.",
    role: "researcher",
    status: "done",
    dependsOn: [],
    startedAt: "2026-05-12T07:45:30.000Z",
    completedAt: "2026-05-12T07:46:14.000Z",
    output: {
      topic: "Bun",
      notes: [
        "Bun 1.2 ships a built-in S3 client (`Bun.s3`), no SDK needed.",
        "Workspace `pnpm`/`yarn` lockfiles are read directly — no migration step.",
        "Bun ships its own bundler, transpiler, test runner, and package manager in one binary.",
        "Postgres + Redis clients are now native (no separate driver install).",
        "[unverified] some teams report 4–8× faster cold-start vs Node 22 in CI.",
      ].join("\n"),
    },
  },
  {
    id: "research-wasm",
    title: "Research WebAssembly",
    description: "Find 5–6 facts about WebAssembly's 2026 state of the art.",
    role: "researcher",
    status: "done",
    dependsOn: [],
    startedAt: "2026-05-12T07:45:32.000Z",
    completedAt: "2026-05-12T07:46:21.000Z",
    output: {
      topic: "WebAssembly",
      notes: [
        "Component Model is now stable and shipping in major runtimes.",
        "WASI Preview 2 standardizes I/O across browsers + servers.",
        "Bytecode Alliance projects (wasmtime, wasmCloud) are the production references.",
        "Cloudflare Workers and Fastly run WASM at the edge.",
        "[unverified] startup latency for a small WASM module is ~40 µs in modern engines.",
      ].join("\n"),
    },
  },
  {
    id: "write-bun-summary",
    title: "Write Bun summary",
    description: "Turn the Bun research into ~120 words for a busy reader.",
    role: "writer",
    status: "done",
    dependsOn: ["research-bun"],
    startedAt: "2026-05-12T07:46:18.000Z",
    completedAt: "2026-05-12T07:46:51.000Z",
    output: {
      topic: "Bun",
      summary:
        "Bun 1.2 is the version where the all-in-one pitch stops being a meme and starts being practical: one binary that bundles a runtime, transpiler, test runner, package manager, and now first-party S3, Postgres, and Redis clients. You can drop in for a `pnpm install`/`yarn install` workflow without a migration step — Bun reads existing lockfiles. Teams using it in CI are reporting cold-start improvements measured in multiples rather than percentages, though benchmarks vary by workload. For a small team that doesn't want to maintain a Node + bundler + test runner toolchain separately, Bun is now a credible default rather than a curiosity.",
    },
  },
  {
    id: "write-wasm-summary",
    title: "Write WebAssembly summary",
    description: "Turn the WASM research into ~120 words.",
    role: "writer",
    status: "done",
    dependsOn: ["research-wasm"],
    startedAt: "2026-05-12T07:46:24.000Z",
    completedAt: "2026-05-12T07:46:58.000Z",
    output: {
      topic: "WebAssembly",
      summary:
        "WebAssembly's 2026 story is finally the one its proponents have been promising for years: a portable byte-code runtime that runs in browsers, on servers, and at the edge with the same module. The stabilization of the Component Model and WASI Preview 2 is the headline — they're the difference between writing a one-off compiled blob and shipping a library that interoperates with anyone's WASM host. Cloudflare Workers and Fastly's edge runtimes have made WASM the default unit of deployment for new edge code. For a developer evaluating where to invest in 2026: the language is no longer experimental and the toolchain (wasmtime, wasmCloud, jco) is mature.",
    },
  },
  {
    id: "edit-brief",
    title: "Edit the combined brief",
    description: "Merge both summaries into one polished one-page brief titled 'Tuesday Brief'.",
    role: "editor",
    status: "review",
    dependsOn: ["write-bun-summary", "write-wasm-summary"],
    startedAt: "2026-05-12T07:47:02.000Z",
    completedAt: "2026-05-12T07:47:40.000Z",
    output: {
      title: "Tuesday Brief — Bun + WebAssembly",
      markdown:
        "# Tuesday Brief — Bun + WebAssembly\n\n" +
        "## Bun 1.2 — the all-in-one pitch finally lands\n\n" +
        "Bun 1.2 is the version where the all-in-one pitch stops being a meme. One binary now bundles a runtime, transpiler, test runner, package manager, and first-party S3, Postgres, and Redis clients. Teams using it in CI report cold-start improvements measured in multiples rather than percentages, though benchmarks vary by workload. Adoption cost is unusually low: Bun reads existing pnpm and yarn lockfiles, so a switchover doesn't require a migration commit.\n\n" +
        "## WebAssembly — the portable runtime year\n\n" +
        "WebAssembly's 2026 story is finally the one its proponents have been promising. The stabilization of the Component Model and WASI Preview 2 is the headline — they're the difference between writing a one-off compiled blob and shipping a portable library that interoperates with anyone's WASM host. Cloudflare Workers and Fastly's edge runtimes have made WASM the default unit of deployment for new edge code.\n\n" +
        "## What it means for your 10 AM\n\n" +
        "If the call touches build tooling or edge compute, both topics are now in the 'practical default' bucket rather than the 'interesting bet' bucket. Worth flagging.",
    },
  },
  {
    id: "publish-brief",
    title: "Save brief to Desktop",
    description: "Write the final edited brief to ~/Desktop/tuesday-brief.md.",
    role: "publisher",
    status: "in-progress",
    dependsOn: ["edit-brief"],
    startedAt: "2026-05-12T07:47:41.000Z",
  },
];

export const DEMO_TASKS: readonly TaskRecord[] = DEMO_TASKS_RAW.map((raw) => ({
  id: raw.id,
  projectId: DEMO_PROJECT_ID,
  title: raw.title,
  description: raw.description,
  role: raw.role,
  dependsOn: raw.dependsOn,
  input: {},
  origin: { kind: "operator" } as const,
  priority: raw.priority ?? "normal",
  createdAt: DEMO_CREATED_AT,
  status: raw.status,
  attempts:
    raw.status === "done" || raw.status === "review" || raw.status === "in-progress" ? 1 : 0,
  ...(raw.startedAt ? { startedAt: raw.startedAt } : {}),
  ...(raw.completedAt ? { completedAt: raw.completedAt } : {}),
  ...(raw.output !== undefined ? { output: raw.output } : {}),
}));

export function isDemoProject(projectId: string | null): boolean {
  return projectId === DEMO_PROJECT_ID;
}
