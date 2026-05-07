import Darwin
import Foundation
import Testing
@testable import Alien

@Suite(.serialized) struct CommandResolverTests {
    private func makeDefaults() -> UserDefaults {
        // Use a unique suite to avoid cross-suite concurrency on UserDefaults.standard.
        UserDefaults(suiteName: "CommandResolverTests.\(UUID().uuidString)")!
    }

    private func makeLocalDefaults() -> UserDefaults {
        let defaults = self.makeDefaults()
        defaults.set(AppState.ConnectionMode.local.rawValue, forKey: connectionModeKey)
        return defaults
    }

    private func makeProjectRootWithPnpm() throws -> (tmp: URL, pnpmPath: URL) {
        let tmp = try makeTempDirForTests()
        let pnpmPath = tmp.appendingPathComponent("node_modules/.bin/pnpm")
        try makeExecutableForTests(at: pnpmPath)
        return (tmp, pnpmPath)
    }

    @Test func `prefers open claw binary`() throws {
        let defaults = self.makeLocalDefaults()

        let tmp = try makeTempDirForTests()

        let alienPath = tmp.appendingPathComponent("node_modules/.bin/alien")
        try makeExecutableForTests(at: alienPath)

        let searchPaths = [tmp.appendingPathComponent("node_modules/.bin").path]
        let cmd = CommandResolver.alienCommand(
            subcommand: "gateway",
            defaults: defaults,
            configRoot: [:],
            searchPaths: searchPaths,
            projectRoot: tmp)
        #expect(cmd.prefix(2).elementsEqual([alienPath.path, "gateway"]))
    }

    @Test func `falls back to node and script`() throws {
        let defaults = self.makeLocalDefaults()

        let tmp = try makeTempDirForTests()

        let nodePath = tmp.appendingPathComponent("node_modules/.bin/node")
        let scriptPath = tmp.appendingPathComponent("bin/alien.js")
        try makeExecutableForTests(at: nodePath)
        try "#!/bin/sh\necho v22.16.0\n".write(to: nodePath, atomically: true, encoding: .utf8)
        try FileManager().setAttributes([.posixPermissions: 0o755], ofItemAtPath: nodePath.path)
        try makeExecutableForTests(at: scriptPath)

        let cmd = CommandResolver.alienCommand(
            subcommand: "rpc",
            defaults: defaults,
            configRoot: [:],
            searchPaths: [tmp.appendingPathComponent("node_modules/.bin").path],
            projectRoot: tmp)

        #expect(cmd.count >= 3)
        if cmd.count >= 3 {
            #expect(cmd[0] == nodePath.path)
            #expect(cmd[1] == scriptPath.path)
            #expect(cmd[2] == "rpc")
        }
    }

    @Test func `prefers open claw binary over pnpm`() throws {
        let defaults = self.makeLocalDefaults()

        let tmp = try makeTempDirForTests()

        let binDir = tmp.appendingPathComponent("bin")
        let alienPath = binDir.appendingPathComponent("alien")
        let pnpmPath = binDir.appendingPathComponent("pnpm")
        try makeExecutableForTests(at: alienPath)
        try makeExecutableForTests(at: pnpmPath)

        let cmd = CommandResolver.alienCommand(
            subcommand: "rpc",
            defaults: defaults,
            configRoot: [:],
            searchPaths: [binDir.path],
            projectRoot: tmp)

        #expect(cmd.prefix(2).elementsEqual([alienPath.path, "rpc"]))
    }

    @Test func `uses open claw binary without node runtime`() throws {
        let defaults = self.makeLocalDefaults()

        let tmp = try makeTempDirForTests()

        let binDir = tmp.appendingPathComponent("bin")
        let alienPath = binDir.appendingPathComponent("alien")
        try makeExecutableForTests(at: alienPath)

        let cmd = CommandResolver.alienCommand(
            subcommand: "gateway",
            defaults: defaults,
            configRoot: [:],
            searchPaths: [binDir.path],
            projectRoot: tmp)

        #expect(cmd.prefix(2).elementsEqual([alienPath.path, "gateway"]))
    }

    @Test func `falls back to pnpm`() throws {
        let defaults = self.makeLocalDefaults()
        let (tmp, pnpmPath) = try self.makeProjectRootWithPnpm()

        let cmd = CommandResolver.alienCommand(
            subcommand: "rpc",
            defaults: defaults,
            configRoot: [:],
            searchPaths: [tmp.appendingPathComponent("node_modules/.bin").path])

        #expect(cmd.prefix(4).elementsEqual([pnpmPath.path, "--silent", "alien", "rpc"]))
    }

    @Test func `pnpm keeps extra args after subcommand`() throws {
        let defaults = self.makeLocalDefaults()
        let (tmp, pnpmPath) = try self.makeProjectRootWithPnpm()

        let cmd = CommandResolver.alienCommand(
            subcommand: "health",
            extraArgs: ["--json", "--timeout", "5"],
            defaults: defaults,
            configRoot: [:],
            searchPaths: [tmp.appendingPathComponent("node_modules/.bin").path])

        #expect(cmd.prefix(5).elementsEqual([pnpmPath.path, "--silent", "alien", "health", "--json"]))
        #expect(cmd.suffix(2).elementsEqual(["--timeout", "5"]))
    }

    @Test func `preferred paths start with project node bins`() throws {
        let tmp = try makeTempDirForTests()

        let first = CommandResolver.preferredPaths(
            home: FileManager().homeDirectoryForCurrentUser,
            current: [],
            projectRoot: tmp).first
        #expect(first == tmp.appendingPathComponent("node_modules/.bin").path)
    }

    @Test func `builds SSH command for remote mode`() {
        let defaults = self.makeDefaults()
        defaults.set(AppState.ConnectionMode.remote.rawValue, forKey: connectionModeKey)
        defaults.set("alien@example.com:2222", forKey: remoteTargetKey)
        defaults.set("/tmp/id_ed25519", forKey: remoteIdentityKey)
        defaults.set("/srv/alien", forKey: remoteProjectRootKey)

        let cmd = CommandResolver.alienCommand(
            subcommand: "status",
            extraArgs: ["--json"],
            defaults: defaults,
            configRoot: [:])

        #expect(cmd.first == "/usr/bin/ssh")
        if let marker = cmd.firstIndex(of: "--") {
            #expect(cmd[marker + 1] == "alien@example.com")
        } else {
            #expect(Bool(false))
        }
        #expect(cmd.contains("StrictHostKeyChecking=yes"))
        #expect(!cmd.contains("StrictHostKeyChecking=accept-new"))
        #expect(cmd.contains("UpdateHostKeys=yes"))
        #expect(cmd.contains("-i"))
        #expect(cmd.contains("/tmp/id_ed25519"))
        if let script = cmd.last {
            #expect(script.contains("PRJ='/srv/alien'"))
            #expect(script.contains("cd \"$PRJ\""))
            #expect(script.contains("alien"))
            #expect(script.contains("status"))
            #expect(script.contains("--json"))
            #expect(script.contains("CLI="))
        }
    }

    @Test func `rejects unsafe SSH targets`() {
        #expect(CommandResolver.parseSSHTarget("-oProxyCommand=calc") == nil)
        #expect(CommandResolver.parseSSHTarget("host:-oProxyCommand=calc") == nil)
        #expect(CommandResolver.parseSSHTarget("user@host:2222")?.port == 2222)
    }

    @Test func `config root local overrides remote defaults`() throws {
        let defaults = self.makeDefaults()
        defaults.set(AppState.ConnectionMode.remote.rawValue, forKey: connectionModeKey)
        defaults.set("alien@example.com:2222", forKey: remoteTargetKey)

        let tmp = try makeTempDirForTests()

        let alienPath = tmp.appendingPathComponent("node_modules/.bin/alien")
        try makeExecutableForTests(at: alienPath)

        let cmd = CommandResolver.alienCommand(
            subcommand: "daemon",
            defaults: defaults,
            configRoot: ["gateway": ["mode": "local"]],
            searchPaths: [tmp.appendingPathComponent("node_modules/.bin").path],
            projectRoot: tmp)

        #expect(cmd.first == alienPath.path)
        #expect(cmd.count >= 2)
        if cmd.count >= 2 {
            #expect(cmd[1] == "daemon")
        }
    }
}
