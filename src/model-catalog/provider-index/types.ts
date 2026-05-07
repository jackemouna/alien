import type { ModelCatalogProvider } from "../types.js";

export type AlienProviderIndexPluginInstall = {
  clawhubSpec?: string;
  npmSpec?: string;
  defaultChoice?: "clawhub" | "npm";
  minHostVersion?: string;
  expectedIntegrity?: string;
};

export type AlienProviderIndexPlugin = {
  id: string;
  package?: string;
  source?: string;
  install?: AlienProviderIndexPluginInstall;
};

export type AlienProviderIndexProviderAuthChoice = {
  method: string;
  choiceId: string;
  choiceLabel: string;
  choiceHint?: string;
  assistantPriority?: number;
  assistantVisibility?: "visible" | "manual-only";
  groupId?: string;
  groupLabel?: string;
  groupHint?: string;
  optionKey?: string;
  cliFlag?: string;
  cliOption?: string;
  cliDescription?: string;
  onboardingScopes?: readonly ("text-inference" | "image-generation")[];
};

export type AlienProviderIndexProvider = {
  id: string;
  name: string;
  plugin: AlienProviderIndexPlugin;
  docs?: string;
  categories?: readonly string[];
  authChoices?: readonly AlienProviderIndexProviderAuthChoice[];
  previewCatalog?: ModelCatalogProvider;
};

export type AlienProviderIndex = {
  version: number;
  providers: Readonly<Record<string, AlienProviderIndexProvider>>;
};
