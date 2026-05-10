import SwiftUI

/**
 * Modal sheet for triggering a new orchestrator run. Topics input, optional
 * output path + title overrides, "Run" button that shells out to
 * `alien security orchestrator-run` via OrchestratorRunner.start.
 *
 * The Anthropic API key is resolved at run time: first the ANTHROPIC_API_KEY
 * environment variable, then (if available) the macOS Keychain under
 * service="alien-anthropic" / account="api-key" — set there by Settings →
 * Orchestrator (not in this commit; tracked as follow-up).
 */
@MainActor
struct NewOrchestratorRunPanel: View {
    let onDismiss: () -> Void

    @State private var topicsRaw: String = ""
    @State private var title: String = "Daily Brief"
    @State private var outputPath: String = ""
    @State private var wordTarget: Int = 120
    @State private var isLaunching = false
    @State private var lastError: String?
    @State private var lastRunId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New Orchestrator Run").font(.title3.weight(.semibold))
            Form {
                Section {
                    TextField("Topics (comma-separated)", text: self.$topicsRaw, prompt: Text("WebAssembly, Bun, agentic IDEs"))
                        .textFieldStyle(.roundedBorder)
                    TextField("Title", text: self.$title)
                        .textFieldStyle(.roundedBorder)
                    Stepper(value: self.$wordTarget, in: 60...500, step: 20) {
                        HStack {
                            Text("Words per summary")
                            Spacer()
                            Text("\(self.wordTarget)").foregroundStyle(.secondary)
                        }
                    }
                    TextField("Output path (optional)", text: self.$outputPath, prompt: Text("~/.alien/orchestrator/runs/<runId>.md"))
                        .textFieldStyle(.roundedBorder)
                } header: {
                    Text("Inputs")
                } footer: {
                    Text("ANTHROPIC_API_KEY must be set in the env or stored in Settings → Orchestrator.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)

            if let error = self.lastError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .font(.caption)
            }
            if let runId = self.lastRunId {
                Label("Launched run \(runId). Status updates in the runs list.", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.caption)
            }

            HStack {
                Spacer()
                Button("Cancel") { self.onDismiss() }
                    .keyboardShortcut(.cancelAction)
                Button {
                    Task { await self.launch() }
                } label: {
                    if self.isLaunching {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Run")
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(self.topicsParsed.isEmpty || self.isLaunching)
            }
        }
        .padding(20)
    }

    private var topicsParsed: [String] {
        self.topicsRaw
            .split(separator: ",", omittingEmptySubsequences: true)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private func launch() async {
        self.isLaunching = true
        self.lastError = nil
        self.lastRunId = nil
        defer { self.isLaunching = false }

        let executable = NewOrchestratorRunPanel.resolveAlienExecutablePath()
        let input = OrchestratorRunner.LaunchInput(
            topics: self.topicsParsed,
            title: self.title,
            outputPath: self.outputPath.isEmpty ? nil : NSString(string: self.outputPath).expandingTildeInPath,
            wordTarget: self.wordTarget,
            runId: nil,
            anthropicApiKey: nil,
            alienExecutablePath: executable
        )
        switch await OrchestratorRunner.start(input) {
        case .succeeded(let runId):
            self.lastRunId = runId
            // The runs window polls disk; the new run will appear shortly.
            OrchestratorRunStore.shared.refresh()
        case .failed(let reason):
            self.lastError = reason
        }
    }

    /// Resolve the `alien` CLI path. Falls back to the bundled Node entrypoint
    /// when run inside the Alien.app bundle; in dev (running via swift run) we
    /// try the local pnpm-built path.
    private static func resolveAlienExecutablePath() -> String {
        if let bundled = Bundle.main.path(forResource: "alien", ofType: "mjs") {
            return bundled
        }
        // Dev fallback: look for the repo root via a few well-known relatives.
        let candidates = [
            NSString(string: "~/Developer/alien/alien.mjs").expandingTildeInPath,
            "/usr/local/bin/alien",
            "/opt/homebrew/bin/alien",
        ]
        for candidate in candidates {
            if FileManager.default.isExecutableFile(atPath: candidate)
                || FileManager.default.fileExists(atPath: candidate)
            {
                return candidate
            }
        }
        return "alien"
    }
}
