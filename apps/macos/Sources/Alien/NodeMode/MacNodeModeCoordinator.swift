import Foundation
import AlienKit
import OSLog

@MainActor
final class MacNodeModeCoordinator {
    static let shared = MacNodeModeCoordinator()

    private let logger = Logger(subsystem: "ai.alien", category: "mac-node")
    private var task: Task<Void, Never>?
    private let runtime = MacNodeRuntime()
    private let session = GatewayNodeSession()
    private var autoRepairedTLSFingerprintsByStoreKey: [String: String] = [:]

    func start() {
        guard self.task == nil else { return }
        self.task = Task { [weak self] in
            await self?.run()
        }
    }

    func stop() {
        self.task?.cancel()
        self.task = nil
        Task { await self.session.disconnect() }
    }

    func setPreferredGatewayStableID(_ stableID: String?) {
        GatewayDiscoveryPreferences.setPreferredStableID(stableID)
        Task { await self.session.disconnect() }
    }

    private func run() async {
        var retryDelay: UInt64 = 1_000_000_000
        var lastCameraEnabled: Bool?
        var lastBrowserControlEnabled: Bool?
        let defaults = UserDefaults.standard

        while !Task.isCancelled {
            if await MainActor.run(body: { AppStateStore.shared.isPaused }) {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                continue
            }

            let cameraEnabled = defaults.object(forKey: cameraEnabledKey) as? Bool ?? false
            if lastCameraEnabled == nil {
                lastCameraEnabled = cameraEnabled
            } else if lastCameraEnabled != cameraEnabled {
                lastCameraEnabled = cameraEnabled
                await self.session.disconnect()
                try? await Task.sleep(nanoseconds: 200_000_000)
            }
            let browserControlEnabled = AlienConfigFile.browserControlEnabled()
            if lastBrowserControlEnabled == nil {
                lastBrowserControlEnabled = browserControlEnabled
            } else if lastBrowserControlEnabled != browserControlEnabled {
                lastBrowserControlEnabled = browserControlEnabled
                await self.session.disconnect()
                try? await Task.sleep(nanoseconds: 200_000_000)
            }

            var attemptedURL: URL?
            do {
                let config = try await GatewayEndpointStore.shared.requireConfig()
                attemptedURL = config.url
                let caps = self.currentCaps()
                let commands = self.currentCommands(caps: caps)
                let permissions = await self.currentPermissions()
                let connectOptions = GatewayConnectOptions(
                    role: "node",
                    scopes: [],
                    caps: caps,
                    commands: commands,
                    permissions: permissions,
                    clientId: "alien-macos",
                    clientMode: "node",
                    clientDisplayName: InstanceIdentity.displayName)
                let sessionBox = self.buildSessionBox(url: config.url)

                try await self.session.connect(
                    url: config.url,
                    token: config.token,
                    bootstrapToken: nil,
                    password: config.password,
                    connectOptions: connectOptions,
                    sessionBox: sessionBox,
                    onConnected: { [weak self] in
                        guard let self else { return }
                        self.logger.info("mac node connected to gateway")
                        let mainSessionKey = await GatewayConnection.shared.mainSessionKey()
                        await self.runtime.updateMainSessionKey(mainSessionKey)
                        await self.runtime.setEventSender { [weak self] event, payload in
                            guard let self else { return }
                            await self.session.sendEvent(event: event, payloadJSON: payload)
                        }
                    },
                    onDisconnected: { [weak self] reason in
                        guard let self else { return }
                        await self.runtime.setEventSender(nil)
                        self.logger.error("mac node disconnected: \(reason, privacy: .public)")
                    },
                    onInvoke: { [weak self] req in
                        guard let self else {
                            return BridgeInvokeResponse(
                                id: req.id,
                                ok: false,
                                error: AlienNodeError(code: .unavailable, message: "UNAVAILABLE: node not ready"))
                        }
                        return await self.runtime.handleInvoke(req)
                    })

                retryDelay = 1_000_000_000
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            } catch {
                if await self.autoRepairStaleTLSPinIfNeeded(error: error, url: attemptedURL) {
                    retryDelay = 1_000_000_000
                    continue
                }
                self.logger.error("mac node gateway connect failed: \(error.localizedDescription, privacy: .public)")
                try? await Task.sleep(nanoseconds: min(retryDelay, 10_000_000_000))
                retryDelay = min(retryDelay * 2, 10_000_000_000)
            }
        }
    }

    nonisolated static func resolvedCaps(
        browserControlEnabled: Bool,
        cameraEnabled: Bool,
        locationMode: AlienLocationMode,
        connectionMode: AppState.ConnectionMode) -> [String]
    {
        var caps: [String] = [AlienCapability.canvas.rawValue, AlienCapability.screen.rawValue]
        if browserControlEnabled, connectionMode == .local {
            caps.append(AlienCapability.browser.rawValue)
        }
        if cameraEnabled {
            caps.append(AlienCapability.camera.rawValue)
        }
        if locationMode != .off {
            caps.append(AlienCapability.location.rawValue)
        }
        return caps
    }

    private func currentCaps() -> [String] {
        let rawLocationMode = UserDefaults.standard.string(forKey: locationModeKey) ?? "off"
        return Self.resolvedCaps(
            browserControlEnabled: AlienConfigFile.browserControlEnabled(),
            cameraEnabled: UserDefaults.standard.object(forKey: cameraEnabledKey) as? Bool ?? false,
            locationMode: AlienLocationMode(rawValue: rawLocationMode) ?? .off,
            connectionMode: AppStateStore.shared.connectionMode)
    }

    private func currentPermissions() async -> [String: Bool] {
        let statuses = await PermissionManager.status()
        return Dictionary(uniqueKeysWithValues: statuses.map { ($0.key.rawValue, $0.value) })
    }

    nonisolated static func resolvedCommands(caps: [String]) -> [String] {
        var commands: [String] = [
            AlienCanvasCommand.present.rawValue,
            AlienCanvasCommand.hide.rawValue,
            AlienCanvasCommand.navigate.rawValue,
            AlienCanvasCommand.evalJS.rawValue,
            AlienCanvasCommand.snapshot.rawValue,
            AlienCanvasA2UICommand.push.rawValue,
            AlienCanvasA2UICommand.pushJSONL.rawValue,
            AlienCanvasA2UICommand.reset.rawValue,
            MacNodeScreenCommand.snapshot.rawValue,
            MacNodeScreenCommand.record.rawValue,
            AlienSystemCommand.notify.rawValue,
            AlienSystemCommand.which.rawValue,
            AlienSystemCommand.run.rawValue,
            AlienSystemCommand.execApprovalsGet.rawValue,
            AlienSystemCommand.execApprovalsSet.rawValue,
        ]

        let capsSet = Set(caps)
        if capsSet.contains(AlienCapability.browser.rawValue) {
            commands.append(AlienBrowserCommand.proxy.rawValue)
        }
        if capsSet.contains(AlienCapability.camera.rawValue) {
            commands.append(AlienCameraCommand.list.rawValue)
            commands.append(AlienCameraCommand.snap.rawValue)
            commands.append(AlienCameraCommand.clip.rawValue)
        }
        if capsSet.contains(AlienCapability.location.rawValue) {
            commands.append(AlienLocationCommand.get.rawValue)
        }

        return commands
    }

    private func currentCommands(caps: [String]) -> [String] {
        Self.resolvedCommands(caps: caps)
    }

    nonisolated static func tlsPinStoreKey(for url: URL) -> String {
        let host = url.host?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "gateway"
        let port = url.port ?? 443
        return "\(host):\(port)"
    }

    nonisolated static func shouldAutoRepairStaleTLSPin(url: URL, failure: GatewayTLSValidationFailure) -> Bool {
        guard failure.kind == .pinMismatch else { return false }
        guard url.scheme?.lowercased() == "wss" else { return false }
        guard failure.storeKey == nil || failure.storeKey == self.tlsPinStoreKey(for: url) else { return false }
        guard let host = url.host?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !host.isEmpty
        else { return false }

        if LoopbackHost.isLoopback(host) {
            return failure.systemTrustOk
        }

        // Tailscale Serve uses publicly trusted, rotating certificates for *.ts.net names.
        // A stale legacy leaf pin should not leave the companion app half-connected forever.
        if host == "ts.net" || host.hasSuffix(".ts.net") {
            return failure.systemTrustOk
        }

        return false
    }

    private func autoRepairStaleTLSPinIfNeeded(error: Error, url: URL?) async -> Bool {
        guard let tlsError = error as? GatewayTLSValidationError, let url else { return false }
        guard Self.shouldAutoRepairStaleTLSPin(url: url, failure: tlsError.failure) else { return false }
        let storeKey = tlsError.failure.storeKey ?? Self.tlsPinStoreKey(for: url)
        guard let observedFingerprint = tlsError.failure.observedFingerprint else { return false }
        guard self.autoRepairedTLSFingerprintsByStoreKey[storeKey] != observedFingerprint else { return false }

        guard GatewayTLSStore.replaceFingerprint(observedFingerprint, stableID: storeKey) else { return false }
        self.autoRepairedTLSFingerprintsByStoreKey[storeKey] = observedFingerprint
        self.logger.info("replaced stale gateway TLS pin storeKey=\(storeKey, privacy: .public)")
        await self.session.disconnect()
        return true
    }

    private func buildSessionBox(url: URL) -> WebSocketSessionBox? {
        guard url.scheme?.lowercased() == "wss" else { return nil }
        let stableID = Self.tlsPinStoreKey(for: url)
        let stored = GatewayTLSStore.loadFingerprint(stableID: stableID)
        let params = GatewayTLSParams(
            required: true,
            expectedFingerprint: stored,
            allowTOFU: stored == nil,
            storeKey: stableID)
        let session = GatewayTLSPinningSession(params: params)
        return WebSocketSessionBox(session: session)
    }
}
