import Foundation
import Observation
import OSLog

/**
 * Observable store backed by `~/.alien/orchestrator/runs/*.json` — the same
 * files the TS-side `runOrchestratorRun` writes after every task transition.
 * Polls the directory on a short interval; SwiftUI views observe `runs` and
 * `selectedRunId` directly.
 *
 * Pairs with the CLI subcommand `alien security orchestrator-run`. The Mac
 * app does not currently re-implement the runner in Swift; instead it
 * shells out via `OrchestratorRunner.start(...)` and reads the JSON the
 * Node-side runner writes. That keeps state-machine, audit-log integration,
 * and origin-context all in one place (the TS runner).
 */
@MainActor
@Observable
final class OrchestratorRunStore {
    static let shared = OrchestratorRunStore()

    private(set) var runs: [OrchestratorRun] = []
    var selectedRunId: String?

    private let logger = Logger(subsystem: "ai.alien", category: "orchestrator-store")
    private let pollIntervalSeconds: TimeInterval = 2.0
    private var pollTimer: Timer?
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    private init() {
        self.refresh()
        self.startPolling()
    }

    deinit {
        self.pollTimer?.invalidate()
    }

    /// Re-read every `<orchestratorDir>/runs/*.json` from disk. Sorted by
    /// creation time descending so the newest run is first in the list.
    func refresh() {
        let dirURL = self.runsDirectoryURL()
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: dirURL,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else {
            self.runs = []
            return
        }
        let parsed: [OrchestratorRun] = contents
            .filter { $0.pathExtension == "json" }
            .compactMap { url in
                guard let data = try? Data(contentsOf: url) else { return nil }
                do {
                    return try self.decoder.decode(OrchestratorRun.self, from: data)
                } catch {
                    self.logger.warning("failed to parse \(url.lastPathComponent, privacy: .public): \(error.localizedDescription, privacy: .public)")
                    return nil
                }
            }
            .sorted { $0.createdAt > $1.createdAt }
        self.runs = parsed
        if self.selectedRunId == nil {
            self.selectedRunId = parsed.first?.id
        }
    }

    /// Resolve the directory where the TS-side runner persists state.
    /// Honors `ALIEN_STATE_DIR` (matches src/config/paths.ts) so dev
    /// installs that override state-dir see their runs surfaced.
    private func runsDirectoryURL() -> URL {
        let stateDir: String
        if let override = ProcessInfo.processInfo.environment["ALIEN_STATE_DIR"], !override.isEmpty {
            stateDir = override
        } else {
            stateDir = NSString(string: "~/.alien").expandingTildeInPath
        }
        return URL(fileURLWithPath: stateDir)
            .appendingPathComponent("orchestrator", isDirectory: true)
            .appendingPathComponent("runs", isDirectory: true)
    }

    private func startPolling() {
        self.pollTimer?.invalidate()
        self.pollTimer = Timer.scheduledTimer(
            withTimeInterval: self.pollIntervalSeconds,
            repeats: true
        ) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }
}

// MARK: - Run shape

/**
 * Mirror of the Run type from src/orchestrator/types.ts. JSON keys match the
 * persisted shape exactly (the TS runner emits camelCase, the Swift side
 * decodes with the same names). Optional fields cover in-flight states.
 */
struct OrchestratorRun: Decodable, Identifiable, Hashable {
    let id: String
    let workflowId: String
    let createdAt: String
    let startedAt: String?
    let completedAt: String?
    let status: Status
    let tasks: [OrchestratorTask]
    let metadata: [String: AnyCodable]?

    enum Status: String, Decodable, Hashable {
        case pending
        case running
        case succeeded
        case failed
    }
}

struct OrchestratorTask: Decodable, Identifiable, Hashable {
    let id: String
    let role: Role
    let summary: String
    let status: TaskStatus
    let startedAt: String?
    let completedAt: String?
    let error: String?
    let attempts: Int

    enum Role: String, Decodable, Hashable {
        case researcher
        case writer
        case editor
        case publisher
    }

    enum TaskStatus: String, Decodable, Hashable {
        case pending
        case running
        case succeeded
        case failed
        case skipped
    }
}
