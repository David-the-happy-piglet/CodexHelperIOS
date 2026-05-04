import Testing
@testable import CodexCompanionShared

@Test func demoDataIncludesBlockedApprovalThread() {
    #expect(DemoData.threads.contains(where: { $0.status == .blocked && $0.pendingApprovals == 1 }))
}

@Test func demoThreadDetailContainsCompactPreview() {
    #expect(DemoData.detail.preview.changedFilesCount == 7)
    #expect(DemoData.detail.events.count >= 2)
    #expect(DemoData.detail.conversation.count >= 2)
}
