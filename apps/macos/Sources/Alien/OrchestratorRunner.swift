import Foundation
import OSLog
import Subprocess

/**
 * Bridges the Mac app to the TS-side orchestrator. The Mac app does NOT
 * re-implement the runner in Swift; it spawns the `alien` CLI as a child
 * process. Output is streamed to the caller; the TS runner persists state
 * to disk and OrchestratorRunStore picks it up via fsevents-like polling.
 *
 * Invocation shape:
 *   alien security orchestrator-run \
 *     --topics "<comma-separated>" \
 *     --title "<title>" \
 *     --output "<path>" \
 *     --word-target <n> \
 *     --run-id <id>
 *
 * The Mac app passes ANTHROPIC_API_KEY via the child env. The user sets it
 * once in Settings → Orchestrator; the Mac app stores it in the macOS
 * Keychain (matching the M2 pattern already shipped in core).
 */
@MainActor
struct OrchestratorRunner {
    private static let logger = Logger(subsystem: "ai.alien", category: "orchestrator-runner")

    struct LaunchInput {
        let topics: [String]
        let title: String
        let outputPath: String?
        let wordTarget: Int
        let runId: String?
        let anthropicApiKey: String?
        let alienExecutablePath: String
    }

    enum LaunchOutcome {
        case succeeded(runId: String)
        case failed(reason: String)
    }

    /// Spawn `alien security orchestrator-run` with the supplied input. Returns
    /// when the child process exits. Use OrchestratorRunStore to observe state
    /// during the run — the TS runner writes after every task transition.
    static func start(_ input: LaunchInput) async -> LaunchOutcome {
        let resolvedRunId = input.runId ?? "run-\(Int(Date().timeIntervalSince1970))"
        var arguments: [String] = [
            "security",
            "orchestrator-run",
            "--topics", input.topics.joined(separator: ","),
            "--title", input.title,
            "--word-target", String(input.wordTarget),
            "--run-id", resolvedRunId,
        ]
        if let outputPath = input.outputPath, !outputPath.isEmpty {
            arguments.append(contentsOf: ["--output", outputPath])
        }

        var environment = ProcessInfo.processInfo.environment
        if let key = input.anthropicApiKey, !key.isEmpty {
            environment["ANTHROPIC_API_KEY"] = key
        }

        let executable = Executable.path(FilePath(input.alienExecutablePath))
        do {
            let result = try await Subprocess.run(
                executable,
                arguments: Arguments(arguments),
                environment: .custom(environment),
                output: .discarded,
                error: .discarded
            )
            switch result.terminationStatus {
            case .exited(let code) where code == 0:
                Self.logger.info("orchestrator run \(resolvedRunId, privacy: .public) succeeded")
                return .succeeded(runId: resolvedRunId)
            case .exited(let code):
                let reason = "alien security orchestrator-run exited with code \(code)"
                Self.logger.error("\(reason, privacy: .public)")
                return .failed(reason: reason)
            case .unhandledException(let signal):
                let reason = "alien security orchestrator-run died with signal \(signal)"
                Self.logger.error("\(reason, privacy: .public)")
                return .failed(reason: reason)
            }
        } catch {
            let reason = "failed to spawn alien CLI: \(error.localizedDescription)"
            Self.logger.error("\(reason, privacy: .public)")
            return .failed(reason: reason)
        }
    }
}
