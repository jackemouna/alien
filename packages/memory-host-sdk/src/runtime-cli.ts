// Focused runtime contract for memory CLI/UI helpers.

export { formatErrorMessage, withManager } from "./host/alien-runtime-cli.js";
export { formatHelpExamples } from "./host/alien-runtime-cli.js";
export { resolveCommandSecretRefsViaGateway } from "./host/alien-runtime-cli.js";
export { withProgress, withProgressTotals } from "./host/alien-runtime-cli.js";
export { defaultRuntime } from "./host/alien-runtime-cli.js";
export { formatDocsLink } from "./host/alien-runtime-cli.js";
export { colorize, isRich, theme } from "./host/alien-runtime-cli.js";
export { isVerbose, setVerbose } from "./host/alien-runtime-cli.js";
export { shortenHomeInString, shortenHomePath } from "./host/alien-runtime-cli.js";
