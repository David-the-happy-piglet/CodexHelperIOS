import Foundation
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    var pushHooks: PushHookCoordinator?

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor [weak self] in
            self?.pushHooks?.update(deviceToken: deviceToken)
        }
    }
}

