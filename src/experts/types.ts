/**
 * The "company of experts" type model.
 *
 * An Expert is a named role with its own soul snippet, communication tone,
 * skill tags, and an optional restricted tool scope. Each Project assigns
 * a subset of experts; the planner (Phase 2) routes tasks to the best-fit
 * expert from that subset. The Mission Control board renders each expert
 * card with their current task and status.
 *
 * Persistence:
 *   - Bundled experts ship at src/experts/builtin/*.ts and are loaded at
 *     boot.
 *   - User-defined or runtime-added experts live at
 *     ~/.alien/experts/<id>.json (Phase 1+ — Phase 1 ships bundled only).
 *
 * Each expert ID is kebab-case, stable, never renamed (project records
 * reference it). Display fields (`name`, `title`) are free to evolve.
 */

export type ExpertId = string;

export type Expert = {
  /** Stable, kebab-case id. Used in Project.assignedExperts. Never renamed. */
  readonly id: ExpertId;
  /** Display first-name or handle for the expert. */
  readonly name: string;
  /** Short title shown under the name. */
  readonly title: string;
  /** One-line role summary. */
  readonly role: string;
  /** What this expert is here to do — read into their soul on each turn. */
  readonly purpose: string;
  /** Communication style (e.g. "direct, calm, concrete"). */
  readonly tone: string;
  /** Capability tags the planner uses to match tasks. */
  readonly skills: readonly string[];
  /**
   * Subset of the agent toolbelt this expert may use. If omitted, the
   * expert inherits the workspace default. Use to limit dangerous tools
   * (e.g. only the engineering expert gets bash + fs_write).
   */
  readonly toolScope?: readonly string[];
  /**
   * Preferred model. If unset, the workspace default is used. The router
   * may downgrade for cost.
   */
  readonly modelPreference?: { provider: string; model: string };
  /** Avatar emoji or short string rendered on the mission board. */
  readonly avatar?: string;
};

/**
 * Snapshot type the /v1/experts endpoint returns. Same shape as Expert
 * — defined separately so we can extend with runtime fields (e.g.
 * currently-assigned-task-id) without changing the persisted Expert.
 */
export type ExpertSnapshot = Expert;
