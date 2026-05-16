import { estimateCostUsd } from "../projects/cost.js";
import type { LlmClient, LlmCompletionRequest } from "./llm-client.js";
import type { Worker, WorkerInput, WorkerOutput, WorkerRegistry } from "./types.js";

/**
 * MVP workers for the daily-research workflow. Each worker is a thin
 * wrapper around a single LLM call with a role-specific system prompt.
 *
 * Real production workers will eventually call Alien's existing model
 * dispatch + tool execution; for the MVP we keep the surface narrow so
 * the orchestrator pattern itself can be exercised without dragging in
 * the gateway/auth-profile machinery.
 */

export type ResearcherInput = {
  readonly topic: string;
};

export type ResearcherOutput = {
  readonly topic: string;
  readonly notes: string;
};

export type WriterInput = {
  readonly topic: string;
  /** Word target for the produced summary. */
  readonly wordTarget?: number;
};

export type WriterOutput = {
  readonly topic: string;
  readonly summary: string;
};

export type EditorInput = {
  readonly title: string;
};

export type EditorOutput = {
  readonly markdown: string;
};

export type PublisherInput = {
  readonly outputPath: string;
};

export type PublisherOutput = {
  readonly path: string;
  readonly bytes: number;
};

export type WorkerDeps = {
  readonly llm: LlmClient;
  /** Filesystem implementation, injectable for tests. */
  readonly writeFile?: (path: string, contents: string) => Promise<void>;
};

export function createDailyResearchWorkers(deps: WorkerDeps): WorkerRegistry {
  return {
    researcher: createResearcher(deps.llm),
    writer: createWriter(deps.llm),
    editor: createEditor(deps.llm),
    publisher: createPublisher(deps.writeFile),
    "email-handler": createUnsupportedRole("email-handler"),
    "capability-broker": createUnsupportedRole("capability-broker"),
  };
}

function createUnsupportedRole(role: string): Worker {
  return async () => ({
    ok: false,
    error: `${role}: not supported by the daily-research workflow. This role is dispatched via the projects pickup loop instead.`,
  });
}

function createResearcher(llm: LlmClient): Worker {
  return async (input: WorkerInput): Promise<WorkerOutput> => {
    const params = input.task.input as Partial<ResearcherInput>;
    const topic = (params.topic ?? "").trim();
    if (!topic) {
      return { ok: false, error: "researcher: missing required input.topic" };
    }
    try {
      const completion = await llm.complete(
        completionRequest({
          system:
            "You are a research assistant. Produce 4–6 concise factual bullet points " +
            "about the user-supplied topic. Avoid speculation; mark uncertain claims " +
            "with [unverified].",
          user: topic,
          purpose: "researcher",
          signal: input.signal,
        }),
      );
      const result: ResearcherOutput = { topic, notes: completion.text };
      return withCost({ ok: true, result }, completion.usage);
    } catch (err) {
      return { ok: false, error: `researcher: ${stringifyError(err)}` };
    }
  };
}

function createWriter(llm: LlmClient): Worker {
  return async (input: WorkerInput): Promise<WorkerOutput> => {
    const params = input.task.input as Partial<WriterInput>;
    const topic = (params.topic ?? "").trim();
    const wordTarget = params.wordTarget ?? 120;
    if (!topic) {
      return { ok: false, error: "writer: missing required input.topic" };
    }
    const research = findFirstDependencyOutput<ResearcherOutput>(input);
    if (!research?.notes) {
      return { ok: false, error: "writer: no upstream research notes available" };
    }
    try {
      const completion = await llm.complete(
        completionRequest({
          system:
            `You are a tech-newsletter writer. Turn the supplied research notes into ` +
            `a single ~${wordTarget}-word summary paragraph for a smart, busy reader. ` +
            `Use plain prose; no headings; no bullet points; no marketing speak.`,
          user: `Topic: ${topic}\n\nNotes:\n${research.notes}`,
          purpose: "writer",
          signal: input.signal,
          maxTokens: Math.max(256, Math.round(wordTarget * 4)),
        }),
      );
      const result: WriterOutput = { topic, summary: completion.text };
      return withCost({ ok: true, result }, completion.usage);
    } catch (err) {
      return { ok: false, error: `writer: ${stringifyError(err)}` };
    }
  };
}

function createEditor(llm: LlmClient): Worker {
  return async (input: WorkerInput): Promise<WorkerOutput> => {
    const params = input.task.input as Partial<EditorInput>;
    const title = (params.title ?? "Daily Brief").trim();
    const summaries = collectAllDependencyOutputs<WriterOutput>(input).filter(
      (item): item is WriterOutput => Boolean(item?.summary),
    );
    if (summaries.length === 0) {
      return { ok: false, error: "editor: no writer outputs to combine" };
    }
    const draft = summaries.map((s) => `## ${s.topic}\n\n${s.summary}`).join("\n\n");
    try {
      const completion = await llm.complete(
        completionRequest({
          system:
            `You are a newsletter editor. The user submits a draft of section ` +
            `headings + paragraphs. Reorganize for flow if needed, fix awkward ` +
            `phrasing, ensure each section reads as a coherent standalone paragraph. ` +
            `Add a single one-sentence introduction at the top under a # Title. ` +
            `Keep all the topics; don't drop any sections.`,
          user: `# ${title}\n\n${draft}`,
          purpose: "editor",
          signal: input.signal,
          maxTokens: 2048,
        }),
      );
      const result: EditorOutput = { markdown: completion.text };
      return withCost({ ok: true, result }, completion.usage);
    } catch (err) {
      return { ok: false, error: `editor: ${stringifyError(err)}` };
    }
  };
}

function createPublisher(
  writeFileImpl?: (filePath: string, contents: string) => Promise<void>,
): Worker {
  return async (input: WorkerInput): Promise<WorkerOutput> => {
    const params = input.task.input as Partial<PublisherInput>;
    const outputPath = (params.outputPath ?? "").trim();
    if (!outputPath) {
      return { ok: false, error: "publisher: missing required input.outputPath" };
    }
    const edited = findFirstDependencyOutput<EditorOutput>(input);
    if (!edited?.markdown) {
      return { ok: false, error: "publisher: no editor output to publish" };
    }
    try {
      const writeFile = writeFileImpl ?? defaultWriteFile;
      await writeFile(outputPath, edited.markdown);
      const bytes = Buffer.byteLength(edited.markdown, "utf8");
      const result: PublisherOutput = { path: outputPath, bytes };
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: `publisher: ${stringifyError(err)}` };
    }
  };
}

async function defaultWriteFile(filePath: string, contents: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, contents, { mode: 0o600 });
}

function findFirstDependencyOutput<T>(input: WorkerInput): T | undefined {
  for (const value of Object.values(input.dependencyOutputs)) {
    if (value && typeof value === "object") {
      return value as T;
    }
  }
  return undefined;
}

function collectAllDependencyOutputs<T>(input: WorkerInput): T[] {
  const out: T[] = [];
  for (const value of Object.values(input.dependencyOutputs)) {
    if (value && typeof value === "object") {
      out.push(value as T);
    }
  }
  return out;
}

function completionRequest(req: LlmCompletionRequest): LlmCompletionRequest {
  return req;
}

function withCost(
  output: WorkerOutput,
  usage: Parameters<typeof estimateCostUsd>[0],
): WorkerOutput {
  const costUsd = estimateCostUsd(usage);
  if (costUsd <= 0) return output;
  return { ...output, costUsd };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
