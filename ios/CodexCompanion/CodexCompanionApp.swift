import SwiftUI

@main
struct CodexCompanionApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var pushHooks = PushHookCoordinator()
    @StateObject private var model = CompanionAppModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        UIScrollView.appearance().keyboardDismissMode = .interactive
        let navigationAppearance = UINavigationBarAppearance()
        navigationAppearance.configureWithOpaqueBackground()
        navigationAppearance.backgroundColor = .systemBackground
        navigationAppearance.shadowColor = .clear
        UINavigationBar.appearance().standardAppearance = navigationAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navigationAppearance
        UINavigationBar.appearance().compactAppearance = navigationAppearance

        let tabAppearance = UITabBarAppearance()
        tabAppearance.configureWithOpaqueBackground()
        tabAppearance.backgroundColor = .systemBackground
        tabAppearance.shadowColor = .separator
        UITabBar.appearance().standardAppearance = tabAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabAppearance
    }

    var body: some Scene {
        WindowGroup {
            InvertedSystemColorScheme {
                MainShellView(model: model, pushHooks: pushHooks)
                    .task {
                        appDelegate.pushHooks = pushHooks
                        await model.bootstrap()
                        pushHooks.register()
                    }
                    .onChange(of: scenePhase) { _, newValue in
                        guard newValue == .active, model.isPaired else { return }
                        Task { try? await model.refreshEverything(connectRealtime: true) }
                    }
            }
        }
    }
}
