import Testing
@testable import CodexCompanionShared

@Test func reconnectBackoffStartsSmall() {
    #expect(ReconnectPolicy.delay(for: 1) == 1)
    #expect(ReconnectPolicy.delay(for: 2) == 2)
}

@Test func reconnectBackoffCapsAtThirtySeconds() {
    #expect(ReconnectPolicy.delay(for: 8) == 30)
}

