import { describeVeniceProviderRuntimeContract } from "alien/plugin-sdk/provider-test-contracts";

describeVeniceProviderRuntimeContract(() => import("./index.js"));
