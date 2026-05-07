export type AlienPiCodingAgentSkillSourceAugmentation = never;

declare module "@mariozechner/pi-coding-agent" {
  interface Skill {
    // Alien relies on the source identifier returned by pi skill loaders.
    source: string;
  }
}
