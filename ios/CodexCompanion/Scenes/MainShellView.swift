import CodexCompanionShared
import SwiftUI

struct MainShellView: View {
    @ObservedObject var model: CompanionAppModel
    @ObservedObject var pushHooks: PushHookCoordinator

    var body: some View {
        ZStack {
            CompanionBackdrop().ignoresSafeArea()

            Group {
                if model.isPaired {
                    TabView {
                        NavigationStack {
                            HomeView(model: model)
                        }
                        .tabItem {
                            Label("Home", systemImage: "house.fill")
                        }

                        NavigationStack {
                            SettingsView(model: model, pushHooks: pushHooks)
                        }
                        .tabItem {
                            Label("Settings", systemImage: "gearshape.fill")
                        }
                    }
                    .toolbarBackground(.visible, for: .tabBar)
                    .toolbarBackground(Color(uiColor: .systemBackground), for: .tabBar)
                    .sheet(item: $model.handoffIntent) { intent in
                        NavigationStack {
                            VStack(alignment: .leading, spacing: 20) {
                                Text("Review on Desktop")
                                    .font(.largeTitle.bold())
                                Text("This thread has been marked for a full desktop review. Keep using the phone for supervision, then continue code review on your computer with the preserved thread context below.")
                                    .foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 12) {
                                    Label(intent.threadID, systemImage: "number")
                                    Label(intent.deeplinkURL.absoluteString, systemImage: "link")
                                        .textSelection(.enabled)
                                }
                                .padding()
                                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                                Spacer()
                            }
                            .padding(24)
                            .navigationTitle("Desktop Handoff")
                            .navigationBarTitleDisplayMode(.inline)
                        }
                        .presentationDetents([.medium, .large])
                    }
                } else {
                    NavigationStack {
                        SettingsView(model: model, pushHooks: pushHooks)
                    }
                }
            }
        }
        .alert("Codex Companion", isPresented: Binding(get: {
            model.errorMessage != nil
        }, set: { newValue in
            if !newValue { model.errorMessage = nil }
        })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
    }
}
