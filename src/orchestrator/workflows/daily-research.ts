import type { Task, WorkflowDefinition } from "../types.js";

/**
 * Daily research newsletter — the first concrete orchestrator workflow.
 *
 * Plan shape (one researcher + writer per topic; one editor; one publisher):
 *
 *   [r:topic-0]  ──▶  [w:topic-0]  ──┐
 *   [r:topic-1]  ──▶  [w:topic-1]  ──┤
 *      …                 …          ├──▶  [editor]  ──▶  [publisher]
 *   [r:topic-N]  ──▶  [w:topic-N]  ──┘
 *
 * Writer N depends on researcher N (1:1). Editor depends on every writer.
 * Publisher depends on the editor. The runner walks tasks in declaration
 * order; researcher-0 runs before researcher-1 (so we don't burn through
 * the LLM API in parallel by accident on the MVP — parallelism is a
 * follow-up that needs careful retry semantics).
 */

export type DailyResearchConfig = {
  /** Workflow run id (filename-safe). */
  readonly runId: string;
  /** List of topics to cover in this run. Each becomes a research+write pair. */
  readonly topics: readonly string[];
  /** Output markdown file path (absolute). */
  readonly outputPath: string;
  /** Newsletter title (default "Daily Brief"). */
  readonly title?: string;
  /** Words per summary (default 120). */
  readonly wordTarget?: number;
};

export const DAILY_RESEARCH_WORKFLOW_ID = "daily-research";

export function planDailyResearchWorkflow(config: DailyResearchConfig): WorkflowDefinition {
  if (config.topics.length === 0) {
    throw new Error("planDailyResearchWorkflow: at least one topic is required");
  }
  const tasks: Task[] = [];

  // 1) One researcher per topic.
  config.topics.forEach((topic, index) => {
    tasks.push({
      id: `research:${index}`,
      role: "researcher",
      summary: `Research "${topic}"`,
      input: { topic },
      dependsOn: [],
    });
  });

  // 2) One writer per topic, each depending on its sibling researcher.
  config.topics.forEach((topic, index) => {
    tasks.push({
      id: `write:${index}`,
      role: "writer",
      summary: `Write summary for "${topic}"`,
      input: {
        topic,
        ...(config.wordTarget ? { wordTarget: config.wordTarget } : {}),
      },
      dependsOn: [`research:${index}`],
    });
  });

  // 3) Editor depends on every writer.
  tasks.push({
    id: "edit",
    role: "editor",
    summary: "Combine + polish all summaries",
    input: { title: config.title ?? "Daily Brief" },
    dependsOn: config.topics.map((_, index) => `write:${index}`),
  });

  // 4) Publisher depends on editor.
  tasks.push({
    id: "publish",
    role: "publisher",
    summary: `Write to ${config.outputPath}`,
    input: { outputPath: config.outputPath },
    dependsOn: ["edit"],
  });

  return {
    id: DAILY_RESEARCH_WORKFLOW_ID,
    name: "Daily Research Newsletter",
    tasks,
    metadata: {
      runId: config.runId,
      topics: [...config.topics],
      outputPath: config.outputPath,
      title: config.title ?? "Daily Brief",
      wordTarget: config.wordTarget ?? 120,
    },
  };
}
