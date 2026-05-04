import Foundation
import UIKit

@MainActor
final class PushHookCoordinator: ObservableObject {
    @Published private(set) var latestDeviceToken: String?

    func register() {
        UIApplication.shared.registerForRemoteNotifications()
    }

    func update(deviceToken: Data) {
        latestDeviceToken = deviceToken.map { String(format: "%02x", $0) }.joined()
    }
}

