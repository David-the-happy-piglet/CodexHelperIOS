import CodexCompanionShared
import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: CompanionAppModel
    @ObservedObject var pushHooks: PushHookCoordinator
    @State private var showingScanner = false

    var body: some View {
        ZStack {
            CompanionBackdrop().ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !model.isPaired {
                        onboarding
                    } else {
                        pairedOverview
                        trustedDevices
                        pairingMaintenance
                    }

                    SectionCard(title: "Notifications", systemImage: "bell.badge") {
                        Text("Local notifications are enabled for approvals and task completion. The APNs hook is ready for a future remote relay.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let token = pushHooks.latestDeviceToken {
                            Text(token)
                                .font(.footnote.monospaced())
                                .textSelection(.enabled)
                        } else {
                            Text("Waiting for device token...")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(20)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarBackground(Color(uiColor: .systemBackground), for: .navigationBar)
        .sheet(isPresented: $showingScanner) {
            QRCodeScannerView { payload in
                model.pairingCodeInput = payload
                showingScanner = false
            }
        }
    }

    private var onboarding: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Codex Companion for iPhone")
                .font(.largeTitle.bold())
            Text("Supervise desktop Codex work from your phone with live progress, approvals, compact previews, and a clean handoff back to desktop for serious review.")
                .font(.body)
                .foregroundStyle(.secondary)

            SectionCard(title: "Pair With Desktop Helper", systemImage: "iphone.gen3.radiowaves.left.and.right") {
                Text("On a real iPhone, do not use localhost. Enter your Mac's LAN address instead, like https://192.168.1.23:9443.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                TextField("Desktop Helper URL", text: $model.helperURLInput)
                    .textContentType(.URL)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                TextField("Pairing code or QR payload", text: $model.pairingCodeInput, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                TextField("This device name", text: $model.deviceName)
                    .textFieldStyle(.roundedBorder)

                HStack {
                    Button("Scan QR") {
                        showingScanner = true
                    }
                    .buttonStyle(.bordered)

                    Button {
                        Task { await model.pairDevice() }
                    } label: {
                        if model.isPairing {
                            ProgressView()
                        } else {
                            Label("Pair iPhone", systemImage: "lock.open.iphone")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
    }

    private var pairedOverview: some View {
        SectionCard(title: "Paired Session", systemImage: "checkmark.icloud") {
            if let currentDevice = model.currentDevice {
                Text(currentDevice.name)
                    .font(.headline)
                Text("Connected to \(model.helperURLInput)")
                    .foregroundStyle(.secondary)
            }
            ConnectionBanner(state: model.connectionBanner, detail: model.lastSyncText)
            HStack {
                Button("Test Connection") {
                    Task { await model.testConnection() }
                }
                .buttonStyle(.bordered)

                Button("Refresh") {
                    Task { try? await model.refreshEverything(connectRealtime: true) }
                }
                .buttonStyle(.borderedProminent)

                Button("Log Out", role: .destructive) {
                    Task { await model.logout() }
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private var trustedDevices: some View {
        SectionCard(title: "Trusted Devices", systemImage: "lock.shield") {
            if model.trustedDevices.isEmpty {
                Text("No trusted devices have been loaded yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.trustedDevices) { device in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(device.name)
                            Text(device.lastSeenAt, style: .relative)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if device.revokedAt != nil {
                            Text("Revoked")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.red)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private var pairingMaintenance: some View {
        SectionCard(title: "Pairing Maintenance", systemImage: "qrcode.viewfinder") {
            Text("You can paste a fresh desktop QR payload here to rebind the session or switch helper hosts.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text("On a real iPhone, localhost points back to the phone. Use your Mac's LAN address instead.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            TextField("Desktop Helper URL", text: $model.helperURLInput)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("Pairing code or QR payload", text: $model.pairingCodeInput)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Pair Again") {
                Task { await model.pairDevice() }
            }
            .buttonStyle(.borderedProminent)
        }
    }
}

#Preview("Settings") {
    NavigationStack {
        SettingsView(model: .previewModel(), pushHooks: PushHookCoordinator())
    }
}
