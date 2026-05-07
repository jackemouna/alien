import Foundation
import Testing
@testable import Alien

@Suite(.serialized) struct NodeServiceManagerTests {
    @Test func `builds node service commands with current CLI shape`() async throws {
        try await TestIsolation.withUserDefaultsValues(["alien.gatewayProjectRootPath": nil]) {
            let tmp = try makeTempDirForTests()
            CommandResolver.setProjectRoot(tmp.path)

            let alienPath = tmp.appendingPathComponent("node_modules/.bin/alien")
            try makeExecutableForTests(at: alienPath)

            let start = NodeServiceManager._testServiceCommand(["start"])
            #expect(start == [alienPath.path, "node", "start", "--json"])

            let stop = NodeServiceManager._testServiceCommand(["stop"])
            #expect(stop == [alienPath.path, "node", "stop", "--json"])
        }
    }
}
