import { describePluginRegistrationContract } from "alien/plugin-sdk/plugin-test-contracts";

describePluginRegistrationContract({
  pluginId: "alibaba",
  videoGenerationProviderIds: ["alibaba"],
  requireGenerateVideo: true,
});
