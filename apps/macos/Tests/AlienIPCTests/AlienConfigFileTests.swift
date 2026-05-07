import Foundation
import Testing
@testable import Alien

@Suite(.serialized)
struct AlienConfigFileTests {
    private func makeConfigOverridePath() -> String {
        FileManager().temporaryDirectory
            .appendingPathComponent("alien-config-\(UUID().uuidString)")
            .appendingPathComponent("alien.json")
            .path
    }

    @Test
    func `config path respects env override`() async {
        let override = self.makeConfigOverridePath()

        await TestIsolation.withEnvValues(["ALIEN_CONFIG_PATH": override]) {
            #expect(AlienConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func `remote gateway port parses and matches host`() async {
        let override = self.makeConfigOverridePath()

        await TestIsolation.withEnvValues(["ALIEN_CONFIG_PATH": override]) {
            AlienConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://gateway.ts.net:19999",
                    ],
                ],
            ])
            #expect(AlienConfigFile.remoteGatewayPort() == 19999)
            #expect(AlienConfigFile.remoteGatewayPort(matchingHost: "gateway.ts.net") == 19999)
            #expect(AlienConfigFile.remoteGatewayPort(matchingHost: "GATEWAY.ts.net.") == 19999)
            #expect(AlienConfigFile.remoteGatewayPort(matchingHost: "gateway") == nil)
            #expect(AlienConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
            #expect(AlienConfigFile.remoteGatewayPort(matchingHost: "gateway.attacker.tld") == nil)
        }
    }

    @MainActor
    @Test
    func `set remote gateway url string replaces scheme`() async {
        let override = self.makeConfigOverridePath()

        await TestIsolation.withEnvValues(["ALIEN_CONFIG_PATH": override]) {
            AlienConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            AlienConfigFile.setRemoteGatewayUrlString("ws://127.0.0.1:18789")
            let root = AlienConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "ws://127.0.0.1:18789")
        }
    }

    @MainActor
    @Test
    func `set remote gateway url preserves scheme`() async {
        let override = self.makeConfigOverridePath()

        await TestIsolation.withEnvValues(["ALIEN_CONFIG_PATH": override]) {
            AlienConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            AlienConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = AlienConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @MainActor
    @Test
    func `clear remote gateway url removes only url field`() async {
        let override = self.makeConfigOverridePath()

        await TestIsolation.withEnvValues(["ALIEN_CONFIG_PATH": override]) {
            AlienConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                        "token": "tok",
                    ],
                ],
            ])
            AlienConfigFile.clearRemoteGatewayUrl()
            let root = AlienConfigFile.loadDict()
            let remote = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any]) ?? [:]
            #expect((remote["url"] as? String) == nil)
            #expect((remote["token"] as? String) == "tok")
        }
    }

    @Test
    func `state dir override sets config path`() async {
        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("alien-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "ALIEN_CONFIG_PATH": nil,
            "ALIEN_STATE_DIR": dir,
        ]) {
            #expect(AlienConfigFile.stateDirURL().path == dir)
            #expect(AlienConfigFile.url().path == "\(dir)/alien.json")
        }
    }

    @MainActor
    @Test
    func `save dict appends config audit log`() async throws {
        let stateDir = FileManager().temporaryDirectory
            .appendingPathComponent("alien-state-\(UUID().uuidString)", isDirectory: true)
        let configPath = stateDir.appendingPathComponent("alien.json")
        let auditPath = stateDir.appendingPathComponent("logs/config-audit.jsonl")

        defer { try? FileManager().removeItem(at: stateDir) }

        try await TestIsolation.withEnvValues([
            "ALIEN_STATE_DIR": stateDir.path,
            "ALIEN_CONFIG_PATH": configPath.path,
        ]) {
            AlienConfigFile.saveDict([
                "gateway": ["mode": "local"],
            ])

            let configData = try Data(contentsOf: configPath)
            let configRoot = try JSONSerialization.jsonObject(with: configData) as? [String: Any]
            #expect((configRoot?["meta"] as? [String: Any]) != nil)

            let rawAudit = try String(contentsOf: auditPath, encoding: .utf8)
            let lines = rawAudit
                .split(whereSeparator: \.isNewline)
                .map(String.init)
            #expect(!lines.isEmpty)
            guard let last = lines.last else {
                Issue.record("Missing config audit line")
                return
            }
            let auditRoot = try JSONSerialization.jsonObject(with: Data(last.utf8)) as? [String: Any]
            #expect(auditRoot?["source"] as? String == "macos-alien-config-file")
            #expect(auditRoot?["event"] as? String == "config.write")
            #expect(auditRoot?["result"] as? String == "success")
            #expect(auditRoot?["configPath"] as? String == configPath.path)
            #expect(auditRoot?["previousMode"] is NSNull)
            #expect(auditRoot?["nextMode"] is NSNumber)
            #expect(auditRoot?["previousIno"] is NSNull)
            #expect(auditRoot?["nextIno"] as? String != nil)
        }
    }

    @MainActor
    @Test
    func `save dict preserves gateway auth unless explicitly allowed`() async throws {
        let stateDir = FileManager().temporaryDirectory
            .appendingPathComponent("alien-state-\(UUID().uuidString)", isDirectory: true)
        let configPath = stateDir.appendingPathComponent("alien.json")

        defer { try? FileManager().removeItem(at: stateDir) }

        await TestIsolation.withEnvValues([
            "ALIEN_STATE_DIR": stateDir.path,
            "ALIEN_CONFIG_PATH": configPath.path,
        ]) {
            AlienConfigFile.saveDict([
                "gateway": [
                    "mode": "remote",
                    "auth": [
                        "mode": "token",
                        "token": "existing-token", // pragma: allowlist secret
                    ],
                ],
            ])

            AlienConfigFile.saveDict([
                "gateway": [
                    "mode": "local",
                ],
            ])

            let root = AlienConfigFile.loadDict()
            let gateway = root["gateway"] as? [String: Any]
            let auth = gateway?["auth"] as? [String: Any]
            #expect(gateway?["mode"] as? String == "local")
            #expect(auth?["mode"] as? String == "token")
            #expect(auth?["token"] as? String == "existing-token") // pragma: allowlist secret

            AlienConfigFile.saveDict([
                "gateway": [
                    "mode": "local",
                ],
            ], allowGatewayAuthMutation: true)

            let allowedRoot = AlienConfigFile.loadDict()
            let allowedGateway = allowedRoot["gateway"] as? [String: Any]
            #expect(allowedGateway?["mode"] as? String == "local")
            #expect((allowedGateway?["auth"] as? [String: Any]) == nil)
        }
    }

    @MainActor
    @Test
    func `save dict can merge local fallback writes with fresh config`() async throws {
        let stateDir = FileManager().temporaryDirectory
            .appendingPathComponent("alien-state-\(UUID().uuidString)", isDirectory: true)
        let configPath = stateDir.appendingPathComponent("alien.json")

        defer { try? FileManager().removeItem(at: stateDir) }

        await TestIsolation.withEnvValues([
            "ALIEN_STATE_DIR": stateDir.path,
            "ALIEN_CONFIG_PATH": configPath.path,
        ]) {
            AlienConfigFile.saveDict([
                "gateway": [
                    "mode": "remote",
                    "auth": [
                        "mode": "password",
                        "password": "existing-password", // pragma: allowlist secret
                    ],
                ],
                "browser": [
                    "enabled": true,
                    "profile": "work",
                ],
                "channels": [
                    "discord": [
                        "enabled": true,
                    ],
                ],
            ])

            AlienConfigFile.saveDict([
                "gateway": [
                    "mode": "local",
                ],
                "browser": [
                    "enabled": false,
                ],
            ], preserveExistingKeys: true)

            let root = AlienConfigFile.loadDict()
            let gateway = root["gateway"] as? [String: Any]
            let auth = gateway?["auth"] as? [String: Any]
            let browser = root["browser"] as? [String: Any]
            let discord = ((root["channels"] as? [String: Any])?["discord"] as? [String: Any])
            #expect(gateway?["mode"] as? String == "local")
            #expect(auth?["mode"] as? String == "password")
            #expect(auth?["password"] as? String == "existing-password") // pragma: allowlist secret
            #expect(browser?["enabled"] as? Bool == false)
            #expect(browser?["profile"] as? String == "work")
            #expect(discord?["enabled"] as? Bool == true)
        }
    }

    @MainActor
    @Test
    func `load dict audits suspicious out-of-band clobbers`() async throws {
        let stateDir = FileManager().temporaryDirectory
            .appendingPathComponent("alien-state-\(UUID().uuidString)", isDirectory: true)
        let configPath = stateDir.appendingPathComponent("alien.json")
        let auditPath = stateDir.appendingPathComponent("logs/config-audit.jsonl")

        defer { try? FileManager().removeItem(at: stateDir) }

        try await TestIsolation.withEnvValues([
            "ALIEN_STATE_DIR": stateDir.path,
            "ALIEN_CONFIG_PATH": configPath.path,
        ]) {
            try AlienConfigFile.withTestingFileLock {
                AlienConfigFile.saveDict([
                    "update": ["channel": "beta"],
                    "browser": ["enabled": true],
                    "gateway": ["mode": "local"],
                    "channels": [
                        "discord": [
                            "enabled": true,
                            "dmPolicy": "pairing",
                        ],
                    ],
                ])
                _ = AlienConfigFile.loadDict()

                let clobbered = """
                {
                  "update": {
                    "channel": "beta"
                  }
                }
                """
                try clobbered.write(to: configPath, atomically: true, encoding: .utf8)

                let loaded = AlienConfigFile.loadDict()
                #expect((loaded["gateway"] as? [String: Any]) == nil)

                let rawAudit = try String(contentsOf: auditPath, encoding: .utf8)
                let lines = rawAudit
                    .split(whereSeparator: \.isNewline)
                    .map(String.init)
                let observeLine = lines.reversed().first { $0.contains("\"event\":\"config.observe\"") }
                #expect(observeLine != nil)
                guard let observeLine else {
                    Issue.record("Missing config.observe audit line")
                    return
                }
                let auditRoot = try JSONSerialization.jsonObject(with: Data(observeLine.utf8)) as? [String: Any]
                #expect(auditRoot?["source"] as? String == "macos-alien-config-file")
                #expect(auditRoot?["configPath"] as? String == configPath.path)
                #expect(auditRoot?["mode"] is NSNumber)
                #expect(auditRoot?["ino"] as? String != nil)
                #expect(auditRoot?["lastKnownGoodMode"] is NSNumber)
                #expect(auditRoot?["backupMode"] is NSNull)
                let suspicious = auditRoot?["suspicious"] as? [String] ?? []
                #expect(suspicious.contains("gateway-mode-missing-vs-last-good"))
                #expect(suspicious.contains("update-channel-only-root"))

                let clobberedPath = auditRoot?["clobberedPath"] as? String
                #expect(clobberedPath != nil)
                if let clobberedPath {
                    let preserved = try String(contentsOfFile: clobberedPath, encoding: .utf8)
                    #expect(preserved == clobbered)
                }
            }
        }
    }
}
