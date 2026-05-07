import { describeGithubCopilotProviderRuntimeContract } from "alien/plugin-sdk/provider-test-contracts";

describeGithubCopilotProviderRuntimeContract(() => import("./index.js"));
