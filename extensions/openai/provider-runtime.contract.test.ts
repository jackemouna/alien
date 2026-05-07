import { describeOpenAIProviderRuntimeContract } from "alien/plugin-sdk/provider-test-contracts";

describeOpenAIProviderRuntimeContract(() => import("./index.js"));
