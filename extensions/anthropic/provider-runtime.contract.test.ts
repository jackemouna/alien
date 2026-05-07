import { describeAnthropicProviderRuntimeContract } from "alien/plugin-sdk/provider-test-contracts";

describeAnthropicProviderRuntimeContract(() => import("./index.js"));
