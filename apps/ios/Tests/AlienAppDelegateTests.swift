import Testing
@testable import Alien

@Suite(.serialized) struct AlienAppDelegateTests {
    @Test @MainActor func resolvesRegistryModelBeforeViewTaskAssignsDelegateModel() {
        let registryModel = NodeAppModel()
        AlienAppModelRegistry.appModel = registryModel
        defer { AlienAppModelRegistry.appModel = nil }

        let delegate = AlienAppDelegate()

        #expect(delegate._test_resolvedAppModel() === registryModel)
    }

    @Test @MainActor func prefersExplicitDelegateModelOverRegistryFallback() {
        let registryModel = NodeAppModel()
        let explicitModel = NodeAppModel()
        AlienAppModelRegistry.appModel = registryModel
        defer { AlienAppModelRegistry.appModel = nil }

        let delegate = AlienAppDelegate()
        delegate.appModel = explicitModel

        #expect(delegate._test_resolvedAppModel() === explicitModel)
    }
}
