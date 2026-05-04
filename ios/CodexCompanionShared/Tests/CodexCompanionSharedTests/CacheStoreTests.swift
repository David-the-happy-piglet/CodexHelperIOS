import Foundation
import Testing
@testable import CodexCompanionShared

@Test func cacheStoreRoundTripsSavedState() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let store = CompanionCacheStore(baseDirectory: directory)
    let state = CachedCompanionState(
        threads: DemoData.threads,
        threadDetails: [DemoData.detail.thread.id: DemoData.detail],
        health: DemoData.health,
        savedAt: Date()
    )

    try await store.save(state)
    let loaded = try await store.load()

    #expect(loaded?.threads.count == 2)
    #expect(loaded?.threadDetails[DemoData.detail.thread.id]?.latestPlan.count == 3)
}

