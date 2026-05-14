export type ThemeName = "alien" | "claw" | "knot" | "dash" | "custom";
export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme =
  | "alien"
  | "alien-light"
  | "dark"
  | "light"
  | "openknot"
  | "openknot-light"
  | "dash"
  | "dash-light"
  | "custom"
  | "custom-light";

export const VALID_THEME_NAMES = new Set<ThemeName>(["alien", "claw", "knot", "dash", "custom"]);
const VALID_THEME_MODES = new Set<ThemeMode>(["system", "light", "dark"]);

type ThemeSelection = { theme: ThemeName; mode: ThemeMode };

const LEGACY_MAP: Record<string, ThemeSelection> = {
  defaultTheme: { theme: "alien", mode: "light" },
  docsTheme: { theme: "alien", mode: "light" },
  lightTheme: { theme: "alien", mode: "light" },
  landingTheme: { theme: "alien", mode: "light" },
  newTheme: { theme: "alien", mode: "light" },
  dark: { theme: "alien", mode: "dark" },
  light: { theme: "alien", mode: "light" },
  openknot: { theme: "knot", mode: "dark" },
  fieldmanual: { theme: "dash", mode: "dark" },
  clawdash: { theme: "dash", mode: "light" },
  system: { theme: "alien", mode: "system" },
};

function prefersLightScheme(): boolean {
  if (typeof globalThis.matchMedia !== "function") {
    return false;
  }
  return globalThis.matchMedia("(prefers-color-scheme: light)").matches;
}

export function resolveSystemTheme(): ResolvedTheme {
  return prefersLightScheme() ? "light" : "dark";
}

export function parseThemeSelection(
  themeRaw: unknown,
  modeRaw: unknown,
): { theme: ThemeName; mode: ThemeMode } {
  const theme = typeof themeRaw === "string" ? themeRaw : "";
  const mode = typeof modeRaw === "string" ? modeRaw : "";

  const normalizedTheme = VALID_THEME_NAMES.has(theme as ThemeName)
    ? (theme as ThemeName)
    : (LEGACY_MAP[theme]?.theme ?? "alien");
  const normalizedMode = VALID_THEME_MODES.has(mode as ThemeMode)
    ? (mode as ThemeMode)
    : (LEGACY_MAP[theme]?.mode ?? "system");

  return { theme: normalizedTheme, mode: normalizedMode };
}

function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return prefersLightScheme() ? "light" : "dark";
  }
  return mode;
}

export function resolveTheme(theme: ThemeName, mode: ThemeMode): ResolvedTheme {
  const resolvedMode = resolveMode(mode);
  if (theme === "alien") {
    return resolvedMode === "light" ? "alien-light" : "alien";
  }
  if (theme === "claw") {
    return resolvedMode === "light" ? "light" : "dark";
  }
  if (theme === "knot") {
    return resolvedMode === "light" ? "openknot-light" : "openknot";
  }
  if (theme === "dash") {
    return resolvedMode === "light" ? "dash-light" : "dash";
  }
  return resolvedMode === "light" ? "custom-light" : "custom";
}
