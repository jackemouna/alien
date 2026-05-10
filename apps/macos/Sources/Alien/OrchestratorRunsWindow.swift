import SwiftUI

/**
 * "Orchestrator Runs" window: list of past + in-flight runs on the left,
 * detail view on the right. Triggered from the menu bar (see MenuContentView).
 *
 * Pattern intentionally mirrors AgentEventsWindow — single SwiftUI View that
 * reads from a shared @Observable store. The store polls disk every 2s, so
 * a running orchestrator updates this UI as tasks transition.
 */
@MainActor
struct OrchestratorRunsWindow: View {
    private let store = OrchestratorRunStore.shared
    @State private var showingNewRunPanel = false

    var body: some View {
        NavigationSplitView {
            self.runList
                .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 320)
        } detail: {
            self.runDetail
        }
        .frame(minWidth: 720, minHeight: 480)
        .navigationTitle("Orchestrator Runs")
        .toolbar {
            ToolbarItem {
                Button {
                    self.showingNewRunPanel = true
                } label: {
                    Label("New Run", systemImage: "play.circle.fill")
                }
                .help("Launch a new orchestrator run")
            }
        }
        .sheet(isPresented: self.$showingNewRunPanel) {
            NewOrchestratorRunPanel(onDismiss: { self.showingNewRunPanel = false })
                .frame(minWidth: 480, minHeight: 340)
        }
    }

    private var runList: some View {
        List(selection: self.binding(for: self.store.selectedRunId)) {
            ForEach(self.store.runs) { run in
                RunRow(run: run).tag(run.id)
            }
            if self.store.runs.isEmpty {
                Text("No runs yet.")
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 6)
            }
        }
        .listStyle(.sidebar)
    }

    @ViewBuilder
    private var runDetail: some View {
        if let runId = self.store.selectedRunId,
           let run = self.store.runs.first(where: { $0.id == runId })
        {
            RunDetailView(run: run)
        } else {
            ContentUnavailableView(
                "Select a run",
                systemImage: "list.bullet.rectangle",
                description: Text("Pick a run from the list to see task status and output path.")
            )
        }
    }

    private func binding(for value: String?) -> Binding<String?> {
        Binding(
            get: { value },
            set: { self.store.selectedRunId = $0 }
        )
    }
}

private struct RunRow: View {
    let run: OrchestratorRun

    var body: some View {
        HStack(spacing: 8) {
            StatusDot(status: self.run.status)
            VStack(alignment: .leading, spacing: 2) {
                Text(self.run.id).font(.callout).lineLimit(1)
                Text(self.subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.vertical, 2)
    }

    private var subtitle: String {
        let succeeded = self.run.tasks.filter { $0.status == .succeeded }.count
        let total = self.run.tasks.count
        return "\(self.run.workflowId) · \(succeeded)/\(total)"
    }
}

private struct RunDetailView: View {
    let run: OrchestratorRun

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                self.header
                Divider()
                self.tasksList
                if let outputPath = self.outputPath {
                    Divider()
                    self.outputSection(path: outputPath)
                }
            }
            .padding(16)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                StatusDot(status: self.run.status)
                Text(self.run.id).font(.title3.weight(.semibold))
                Spacer()
                Text(self.run.status.rawValue)
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.quaternary, in: Capsule())
            }
            HStack(spacing: 12) {
                Label(self.run.workflowId, systemImage: "scribble.variable")
                if let started = self.run.startedAt {
                    Label(started, systemImage: "clock")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    private var tasksList: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Tasks").font(.headline)
            ForEach(self.run.tasks) { task in
                HStack(alignment: .top, spacing: 8) {
                    TaskStatusGlyph(status: task.status)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(task.summary).font(.body)
                        HStack(spacing: 6) {
                            Text(task.role.rawValue.capitalized)
                            Text("·")
                            Text(task.id)
                            if task.attempts > 1 {
                                Text("· \(task.attempts) attempts")
                            }
                        }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        if let error = task.error {
                            Text(error)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .lineLimit(3)
                        }
                    }
                    Spacer()
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var outputPath: String? {
        guard let metadata = self.run.metadata,
              let outputEntry = metadata["outputPath"],
              let path = outputEntry.value as? String
        else { return nil }
        return path
    }

    private func outputSection(path: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Output").font(.headline)
            HStack(spacing: 6) {
                Text(path).font(.callout.monospaced()).lineLimit(2)
                Spacer()
                if self.run.status == .succeeded {
                    Button("Reveal") {
                        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }
}

private struct StatusDot: View {
    let status: OrchestratorRun.Status

    var body: some View {
        Circle()
            .fill(self.color)
            .frame(width: 8, height: 8)
    }

    private var color: Color {
        switch self.status {
        case .pending: return .gray
        case .running: return .blue
        case .succeeded: return .green
        case .failed: return .red
        }
    }
}

private struct TaskStatusGlyph: View {
    let status: OrchestratorTask.TaskStatus

    var body: some View {
        Image(systemName: self.symbol)
            .font(.body)
            .foregroundStyle(self.color)
            .frame(width: 18, height: 18)
    }

    private var symbol: String {
        switch self.status {
        case .pending: return "circle.dashed"
        case .running: return "arrow.triangle.2.circlepath"
        case .succeeded: return "checkmark.circle.fill"
        case .failed: return "xmark.octagon.fill"
        case .skipped: return "minus.circle"
        }
    }

    private var color: Color {
        switch self.status {
        case .pending: return .secondary
        case .running: return .blue
        case .succeeded: return .green
        case .failed: return .red
        case .skipped: return .secondary
        }
    }
}
