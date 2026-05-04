#if canImport(ActivityKit) && os(iOS)
@preconcurrency import ActivityKit
import Foundation

public struct LiveThreadActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public let title: String
        public let status: String
        public let elapsedText: String
        public let phase: String

        public init(title: String, status: String, elapsedText: String, phase: String) {
            self.title = title
            self.status = status
            self.elapsedText = elapsedText
            self.phase = phase
        }
    }

    public let threadID: String
    public let projectName: String

    public init(threadID: String, projectName: String) {
        self.threadID = threadID
        self.projectName = projectName
    }
}

public actor LiveActivityCoordinator {
    private var activity: Activity<LiveThreadActivityAttributes>?

    public init() {}

    public func update(with thread: ThreadSummary, latestPhase: String = "Supervising") async {
        let state = LiveThreadActivityAttributes.ContentState(
            title: thread.title,
            status: thread.status.rawValue.capitalized,
            elapsedText: formatElapsed(seconds: thread.elapsedSeconds),
            phase: latestPhase
        )

        if let activity {
            await activity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(120)))
        } else {
            activity = try? Activity.request(
                attributes: LiveThreadActivityAttributes(threadID: thread.id, projectName: thread.projectName),
                content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(120))
            )
        }
    }

    public func end() async {
        guard let activity else { return }
        await activity.end(nil, dismissalPolicy: .immediate)
        self.activity = nil
    }

    private func formatElapsed(seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }
}
#else
import Foundation

public struct LiveThreadActivityAttributes: Sendable {
    public init(threadID: String, projectName: String) {}
}

public actor LiveActivityCoordinator {
    public init() {}
    public func update(with thread: ThreadSummary, latestPhase: String = "Supervising") async {}
    public func end() async {}
}
#endif
