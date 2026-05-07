import { describeOpenRouterProviderRuntimeContract } from "alien/plugin-sdk/provider-test-contracts";

describeOpenRouterProviderRuntimeContract(() => import("./index.js"));
