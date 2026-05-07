import { listSkillCommandsForAgents as listSkillCommandsForAgentsImpl } from "alien/plugin-sdk/command-auth";

type ListSkillCommandsForAgents =
  typeof import("alien/plugin-sdk/command-auth").listSkillCommandsForAgents;

export function listSkillCommandsForAgents(
  ...args: Parameters<ListSkillCommandsForAgents>
): ReturnType<ListSkillCommandsForAgents> {
  return listSkillCommandsForAgentsImpl(...args);
}
