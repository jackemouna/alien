/**
 * Starter templates — opinionated, copy-paste-able prompts that show new
 * users what their Alien team can do. Each template ships as a JSON file
 * under `templates/<id>.json` so non-developers can add or edit them by
 * hand, and the UI Templates gallery renders them in the empty state.
 */

export type StarterTemplate = {
  readonly id: string;
  /** Human-readable card title. */
  readonly name: string;
  /** One-line teaser shown under the title in the gallery. */
  readonly tagline: string;
  /** Optional decorative emoji. */
  readonly icon?: string;
  /** A paragraph explaining what the user gets if they use this. */
  readonly description: string;
  /**
   * Integrations the template needs. The UI dims cards whose requirements
   * are not yet configured ("Gmail needs connecting first"). Known values:
   *   - "gmail"
   *   - "slack"   (v0.2+)
   *
   * An empty array means the template works out of the box once Alien has
   * an Anthropic API key.
   */
  readonly requires: readonly string[];
  /** The prompt the UI pre-fills when the user clicks "Use this template". */
  readonly starterPrompt: string;
  /** Suggested project name. The user can rename before creating. */
  readonly defaultProjectName: string;
  /** Suggested goal blurb (free-form). */
  readonly defaultGoal: string;
};
