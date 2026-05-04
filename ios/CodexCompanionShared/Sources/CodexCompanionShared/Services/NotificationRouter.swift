import Foundation
import UserNotifications

public final class NotificationRouter: @unchecked Sendable {
    public init() {}

    public func requestAuthorization() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
    }

    public func notifyApproval(_ approval: ApprovalRequest) {
        schedule(
            identifier: approval.id,
            title: approval.title,
            body: approval.rationale,
            category: "approval"
        )
    }

    public func notifyCompletion(for event: ThreadEvent) {
        schedule(identifier: event.id, title: event.title, body: event.detail, category: "task")
    }

    public func notifyFailure(for event: ThreadEvent) {
        schedule(identifier: event.id, title: event.title, body: event.detail, category: "task")
    }

    private func schedule(identifier: String, title: String, body: String, category: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.categoryIdentifier = category
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}
