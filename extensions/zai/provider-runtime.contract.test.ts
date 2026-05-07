import { describeZAIProviderRuntimeContract } from "alien/plugin-sdk/provider-test-contracts";

describeZAIProviderRuntimeContract(() => import("./index.js"));
