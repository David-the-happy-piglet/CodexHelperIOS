import Foundation

public enum DemoData {
    public static let health = ConnectionHealth(
        codexBridge: .healthy,
        websocketClients: 1,
        demoMode: true,
        lastBridgeSyncAt: Date().addingTimeInterval(-30)
    )

    public static let threads: [ThreadSummary] = [
        ThreadSummary(
            id: "thread-pairing",
            projectName: "Codex Companion for iPhone",
            projectPath: "/Users/wenjie/Documents/CS/Projects/CodexHelper IOS",
            branchOrWorktree: "codex/mobile-pairing",
            title: "Ship pairing and reconnect flow",
            status: .running,
            startedAt: Date().addingTimeInterval(-2100),
            updatedAt: Date().addingTimeInterval(-30),
            pendingApprovals: 0,
            elapsedSeconds: 2100,
            previewSummary: PreviewSummary(
                headline: "Pairing is working end to end with certificate pinning and reconnect support.",
                changedFilesCount: 7,
                testsPassed: 12,
                testsFailed: 0,
                needsDesktopReview: false
            )
        ),
        ThreadSummary(
            id: "thread-approval",
            projectName: "Codex Companion for iPhone",
            projectPath: "/Users/wenjie/Documents/CS/Projects/CodexHelper IOS",
            branchOrWorktree: "codex/notifications-and-handoff",
            title: "Stabilize notifications and desktop handoff",
            status: .blocked,
            startedAt: Date().addingTimeInterval(-3200),
            updatedAt: Date().addingTimeInterval(-100),
            pendingApprovals: 1,
            elapsedSeconds: 3200,
            previewSummary: PreviewSummary(
                headline: "One low-risk approval is queued and the remaining deep review is still routed back to desktop.",
                changedFilesCount: 14,
                testsPassed: 8,
                testsFailed: 1,
                needsDesktopReview: true
            )
        ),
    ]

    public static let approvals: [ApprovalRequest] = [
        ApprovalRequest(
            id: "approval-signing",
            threadID: "thread-approval",
            title: "Update release signing defaults",
            rationale: "The helper needs approval before rotating the profile used for notification tests.",
            riskLevel: .low,
            createdAt: Date().addingTimeInterval(-500),
            status: .pending
        )
    ]

    public static let detail = ThreadDetail(
        thread: threads[0],
        latestPlan: [
            "Reconnect the websocket stream from the phone.",
            "Refresh the pairing summary and cache the latest result.",
            "Update the lock-screen Live Activity with the active phase."
        ],
        latestSummary: "Codex is still making progress and the desktop helper remains healthy.",
        preview: ArtifactPreview(
            threadID: "thread-pairing",
            changedFilesCount: 7,
            changedFileNames: [
                "ios/CodexCompanion/Views/Settings/PairingFlowView.swift",
                "desktop-helper/src/auth/AuthSessionManager.ts",
                "ios/CodexCompanionShared/Sources/CodexCompanionShared/Services/RealtimeEventStream.swift",
            ],
            testsPassed: 12,
            testsFailed: 0,
            screenshotURLs: [],
            summary: "Mobile pairing is implemented with certificate pinning, reconnect handling, and cached offline state.",
            needsDesktopReview: false
        ),
        conversation: [
            ConversationMessage(
                id: "msg-1",
                threadID: "thread-pairing",
                turnID: "turn-1",
                kind: .user,
                state: .completed,
                createdAt: Date().addingTimeInterval(-320),
                title: "User request",
                body: "Build the iPhone companion and make pairing feel production-ready."
            ),
            ConversationMessage(
                id: "msg-2",
                threadID: "thread-pairing",
                turnID: "turn-1",
                kind: .assistant,
                state: .completed,
                createdAt: Date().addingTimeInterval(-290),
                title: "Codex progress",
                body: "I mapped the helper, pairing flow, and Live Activity surface so mobile stays lightweight and supervised."
            ),
            ConversationMessage(
                id: "msg-3",
                threadID: "thread-pairing",
                turnID: "turn-2",
                kind: .plan,
                state: .completed,
                createdAt: Date().addingTimeInterval(-180),
                title: "Current plan",
                body: "Reconnect the websocket, refresh the cache, then update the selected Live Activity.",
                supplemental: ["Reconnect", "Refresh cache", "Update Live Activity"]
            ),
            ConversationMessage(
                id: "msg-4",
                threadID: "thread-pairing",
                turnID: "turn-2",
                kind: .assistant,
                state: .streaming,
                createdAt: Date().addingTimeInterval(-45),
                title: "Latest reply",
                body: "The helper is healthy and I’m finishing the mobile sync pass now."
            ),
        ],
        events: [
            ThreadEvent(
                id: "evt-1",
                threadID: "thread-pairing",
                type: .taskSummaryUpdated,
                timestamp: Date().addingTimeInterval(-40),
                title: "Progress checkpoint",
                detail: "Codex refreshed the compact summary for mobile.",
                severity: .info
            ),
            ThreadEvent(
                id: "evt-2",
                threadID: "thread-pairing",
                type: .artifactGenerated,
                timestamp: Date().addingTimeInterval(-120),
                title: "Artifact preview refreshed",
                detail: "The helper generated a new compact artifact card.",
                severity: .success
            ),
        ],
        approvals: []
    )
}
