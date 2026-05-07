import { describeGoogleProviderRuntimeContract } from "alien/plugin-sdk/provider-test-contracts";

describeGoogleProviderRuntimeContract(() => import("./index.js"));
