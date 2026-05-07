import { describePluginRegistrationContract } from "alien/plugin-sdk/plugin-test-contracts";

describePluginRegistrationContract({
  pluginId: "ollama",
  providerIds: ["ollama"],
  webSearchProviderIds: ["ollama"],
});
