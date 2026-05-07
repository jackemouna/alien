export const ALIEN_CLI_ENV_VAR = "ALIEN_CLI";
export const ALIEN_CLI_ENV_VALUE = "1";

export function markAlienExecEnv<T extends Record<string, string | undefined>>(env: T): T {
  return {
    ...env,
    [ALIEN_CLI_ENV_VAR]: ALIEN_CLI_ENV_VALUE,
  };
}

export function ensureAlienExecMarkerOnProcess(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  env[ALIEN_CLI_ENV_VAR] = ALIEN_CLI_ENV_VALUE;
  return env;
}
