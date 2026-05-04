import CodexCompanionShared
import Foundation
import UIKit

@MainActor
final class CompanionAppModel: ObservableObject {
    private static let defaultHelperURLInput: String = {
        #if targetEnvironment(simulator)
        return "https://localhost:9443"
        #else
        return ""
        #endif
    }()

    enum HelperURLError: LocalizedError {
        case localhostOnPhysicalDevice

        var errorDescription: String? {
            switch self {
            case .localhostOnPhysicalDevice:
                "On a real iPhone, localhost points to the phone itself. Use your Mac's LAN IP instead, for example https://192.168.1.23:9443."
            }
        }
    }

    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    @Published var threads: [ThreadSummary] = []
    @Published var threadDetails: [String: ThreadDetail] = [:]
    @Published var trustedDevices: [SessionDevice] = []
    @Published var currentDevice: SessionDevice?
    @Published var health = DemoData.health
    @Published var connectionBanner: ConnectionBannerState = .offline
    @Published var loadState: LoadState = .idle
    @Published var pairingCodeInput = ""
    @Published var helperURLInput = CompanionAppModel.defaultHelperURLInput
    @Published var deviceName = UIDevice.current.name
    @Published var errorMessage: String?
    @Published var selectedLiveThreadID: String?
    @Published var handoffIntent: HandoffIntent?
    @Published var isPairing = false
    @Published var isRefreshing = false

    var pendingApprovals: [ApprovalRequest] {
        threadDetails.values
            .flatMap(\.approvals)
            .filter { $0.status == .pending }
            .sorted { $0.createdAt > $1.createdAt }
    }

    var isPaired: Bool {
        currentDevice != nil
    }

    var lastSyncText: String {
        guard let lastSync = health.lastBridgeSyncAt else { return "Not synced yet" }
        return RelativeDateTimeFormatter().localizedString(for: lastSync, relativeTo: .now)
    }

    private let metadataStore: SessionMetadataStoring
    private let tokenStore: TokenStoring
    private let cacheStore: CompanionCacheStore
    private let apiClient: APIClient
    private let realtime: RealtimeEventStream
    private let notifications: NotificationRouter
    private let liveActivity: LiveActivityCoordinator
    private var reconnectTask: Task<Void, Never>?
    private var reconnectAttempts = 0

    init(
        metadataStore: SessionMetadataStoring = UserDefaultsSessionMetadataStore(),
        tokenStore: TokenStoring = KeychainTokenStore(),
        cacheStore: CompanionCacheStore = CompanionCacheStore(),
        apiClient: APIClient = APIClient(),
        realtime: RealtimeEventStream = RealtimeEventStream(),
        notifications: NotificationRouter = NotificationRouter(),
        liveActivity: LiveActivityCoordinator = LiveActivityCoordinator()
    ) {
        self.metadataStore = metadataStore
        self.tokenStore = tokenStore
        self.cacheStore = cacheStore
        self.apiClient = apiClient
        self.realtime = realtime
        self.notifications = notifications
        self.liveActivity = liveActivity

        realtime.onEvent = { [weak self] event in
            Task { @MainActor in
                self?.handleRealtimeEvent(event)
            }
        }

        realtime.onDisconnect = { [weak self] error in
            Task { @MainActor in
                await self?.scheduleReconnect(because: error)
            }
        }
    }

    func bootstrap() async {
        await loadCachedState()
        await notifications.requestAuthorization()

        do {
            if let metadata = try metadataStore.load() {
                currentDevice = metadata.device
                helperURLInput = metadata.baseURL.absoluteString
                loadState = .loading
                try await refreshEverything(connectRealtime: true)
            } else {
                loadState = .loaded
                connectionBanner = .offline
            }
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    func pairDevice() async {
        isPairing = true
        defer { isPairing = false }

        do {
            let pairing = try PairingPayloadParser.parse(pairingCodeInput, helperURL: helperURLInput)
            try validateHelperURL(pairing.helperURL)
            let response = try await apiClient.exchangePairingCode(
                baseURL: pairing.helperURL,
                request: PairingExchangeRequest(deviceName: deviceName, pairingCode: pairing.code)
            )

            try metadataStore.save(SessionMetadata(baseURL: pairing.helperURL, device: response.device))
            try tokenStore.save(tokens: response.tokens)
            currentDevice = response.device
            helperURLInput = pairing.helperURL.absoluteString
            errorMessage = nil
            loadState = .loading
            try await refreshEverything(connectRealtime: true)
        } catch {
            errorMessage = error.localizedDescription
            loadState = .failed(error.localizedDescription)
        }
    }

    func refreshEverything(connectRealtime shouldConnectRealtime: Bool) async throws {
        isRefreshing = true
        defer { isRefreshing = false }

        let (threadsResponse, deviceResponse) = try await withAuthorizedContext { context in
            let listResponse = try await apiClient.fetchThreads(using: context)
            let devicesResponse = try await apiClient.fetchTrustedDevices(using: context)
            return (listResponse, devicesResponse)
        }
        trustedDevices = deviceResponse.devices
        threads = threadsResponse.threads.sorted { $0.updatedAt > $1.updatedAt }
        health = threadsResponse.health
        connectionBanner = .connected
        loadState = .loaded

        if !threads.isEmpty {
            try await preloadImportantDetails()
        }

        if shouldConnectRealtime {
            let context = try await currentContext()
            startRealtimeConnection(using: context)
        }

        try await persistCache()
        if let selected = selectedLiveThreadID, let thread = threads.first(where: { $0.id == selected }) {
            await liveActivity.update(with: thread)
        }
    }

    func loadDetail(for threadID: String) async {
        do {
            let detail = try await withAuthorizedContext { context in
                try await apiClient.fetchThreadDetail(threadID: threadID, using: context)
            }
            threadDetails[threadID] = detail
            try await persistCache()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func sendCommand(threadID: String, type: CommandType, note: String?) async {
        do {
            try await withAuthorizedContext { context in
                try await apiClient.sendCommand(
                    threadID: threadID,
                    request: ThreadCommandRequest(type: type, note: note?.nilIfEmpty),
                    using: context
                )
            }

            if type == .reviewOnDesktop {
                handoffIntent = HandoffIntent(threadID: threadID)
            }
            await loadDetail(for: threadID)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func sendInput(threadID: String, prompt: String) async {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        do {
            try await withAuthorizedContext { context in
                try await apiClient.sendInput(
                    threadID: threadID,
                    request: ThreadInputRequest(prompt: trimmed),
                    using: context
                )
            }
            await loadDetail(for: threadID)
            refreshDetailSoon(threadID: threadID)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func createProject(name: String, initialThreadTitle: String, initialPrompt: String?) async -> ThreadSummary? {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedTitle = initialThreadTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty, !trimmedTitle.isEmpty else { return nil }

        do {
            let created = try await withAuthorizedContext { context in
                try await apiClient.createProject(
                    request: CreateProjectRequest(
                        name: trimmedName,
                        initialThreadTitle: trimmedTitle,
                        initialPrompt: initialPrompt?.nilIfEmpty
                    ),
                    using: context
                )
            }
            upsert(thread: created)
            await loadDetail(for: created.id)
            try await refreshEverything(connectRealtime: false)
            return created
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func createThread(projectPath: String, title: String, initialPrompt: String?) async -> ThreadSummary? {
        let trimmedPath = projectPath.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPath.isEmpty, !trimmedTitle.isEmpty else { return nil }

        do {
            let created = try await withAuthorizedContext { context in
                try await apiClient.createThread(
                    request: CreateThreadRequest(
                        projectPath: trimmedPath,
                        title: trimmedTitle,
                        initialPrompt: initialPrompt?.nilIfEmpty
                    ),
                    using: context
                )
            }
            upsert(thread: created)
            await loadDetail(for: created.id)
            try await refreshEverything(connectRealtime: false)
            return created
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func resolveApproval(_ approval: ApprovalRequest, action: ApprovalAction, note: String?) async {
        do {
            _ = try await withAuthorizedContext { context in
                try await apiClient.resolveApproval(
                    threadID: approval.threadID,
                    request: ApprovalResolutionRequest(approvalID: approval.id, action: action, note: note?.nilIfEmpty),
                    using: context
                )
            }
            try await refreshEverything(connectRealtime: false)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectLiveActivity(threadID: String?) async {
        selectedLiveThreadID = threadID
        guard let threadID, let thread = threads.first(where: { $0.id == threadID }) else {
            await liveActivity.end()
            return
        }

        await liveActivity.update(with: thread)
    }

    func testConnection() async {
        do {
            guard let url = URL(string: helperURLInput) else { return }
            try validateHelperURL(url)
            health = try await apiClient.fetchHealth(baseURL: url)
            connectionBanner = .connected
        } catch {
            errorMessage = error.localizedDescription
            connectionBanner = .offline
        }
    }

    func logout() async {
        do {
            if let metadata = try metadataStore.load(), let tokens = try tokenStore.loadTokens() {
                try? await apiClient.logout(baseURL: metadata.baseURL, refreshToken: tokens.refreshToken)
            }
            try metadataStore.clear()
            try tokenStore.clear()
            currentDevice = nil
            trustedDevices = []
            threads = []
            threadDetails = [:]
            connectionBanner = .offline
            realtime.disconnect()
            await liveActivity.end()
            try await cacheStore.clear()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func previewSeed() {
        currentDevice = SessionDevice(
            id: "preview-device",
            name: "Wenjie’s iPhone",
            pairedAt: .now.addingTimeInterval(-86_400),
            lastSeenAt: .now
        )
        trustedDevices = [currentDevice!]
        threads = DemoData.threads
        threadDetails = [DemoData.detail.thread.id: DemoData.detail]
        health = DemoData.health
        connectionBanner = .connected
        loadState = .loaded
        selectedLiveThreadID = DemoData.threads.first?.id
    }

    static func previewModel() -> CompanionAppModel {
        let model = CompanionAppModel(
            metadataStore: InMemorySessionMetadataStore(),
            tokenStore: InMemoryTokenStore(),
            cacheStore: CompanionCacheStore(baseDirectory: FileManager.default.temporaryDirectory),
            apiClient: APIClient(),
            realtime: RealtimeEventStream(),
            notifications: NotificationRouter(),
            liveActivity: LiveActivityCoordinator()
        )
        model.previewSeed()
        return model
    }

    private func handleRealtimeEvent(_ event: RealtimeEvent) {
        reconnectAttempts = 0
        connectionBanner = .connected

        switch event {
        case .threadCreated(let thread), .threadUpdated(let thread):
            upsert(thread: thread)
        case .phaseChanged(let update):
            if var detail = threadDetails[update.threadID] {
                detail = ThreadDetail(
                    thread: detail.thread,
                    latestPlan: update.latestPlan,
                    latestSummary: detail.latestSummary,
                    preview: detail.preview,
                    conversation: detail.conversation,
                    events: detail.events,
                    approvals: detail.approvals,
                    latestRawLog: detail.latestRawLog
                )
                threadDetails[update.threadID] = detail
            }
        case .summaryUpdated(let update):
            if var detail = threadDetails[update.threadID] {
                detail = ThreadDetail(
                    thread: detail.thread,
                    latestPlan: detail.latestPlan,
                    latestSummary: update.latestSummary,
                    preview: detail.preview,
                    conversation: detail.conversation,
                    events: detail.events,
                    approvals: detail.approvals,
                    latestRawLog: detail.latestRawLog
                )
                threadDetails[update.threadID] = detail
            }
        case .artifactGenerated(let preview):
            if var detail = threadDetails[preview.threadID] {
                detail = ThreadDetail(
                    thread: detail.thread,
                    latestPlan: detail.latestPlan,
                    latestSummary: detail.latestSummary,
                    preview: preview,
                    conversation: detail.conversation,
                    events: detail.events,
                    approvals: detail.approvals,
                    latestRawLog: detail.latestRawLog
                )
                threadDetails[preview.threadID] = detail
            }
            updatePreviewSummary(using: preview)
        case .approvalRequested(let approval):
            notifications.notifyApproval(approval)
            updateApproval(approval)
            refreshDetailIfLoaded(threadID: approval.threadID)
        case .approvalResolved(let approval):
            updateApproval(approval)
            refreshDetailIfLoaded(threadID: approval.threadID)
        case .taskCompleted(let event):
            notifications.notifyCompletion(for: event)
            append(event: event)
            markThread(event.threadID, status: .done)
            refreshDetailIfLoaded(threadID: event.threadID)
        case .taskFailed(let event):
            notifications.notifyFailure(for: event)
            append(event: event)
            markThread(event.threadID, status: .error)
            refreshDetailIfLoaded(threadID: event.threadID)
        case .connectionHealthChanged(let health):
            self.health = health
            connectionBanner = health.codexBridge == .disconnected ? .offline : .connected
        }

        Task {
            try? await persistCache()
            if let selected = selectedLiveThreadID, let thread = threads.first(where: { $0.id == selected }) {
                await liveActivity.update(with: thread)
            }
        }
    }

    private func upsert(thread: ThreadSummary) {
        if let index = threads.firstIndex(where: { $0.id == thread.id }) {
            threads[index] = thread
        } else {
            threads.append(thread)
        }
        threads.sort { $0.updatedAt > $1.updatedAt }
    }

    private func updatePreviewSummary(using preview: ArtifactPreview) {
        guard let index = threads.firstIndex(where: { $0.id == preview.threadID }) else { return }
        let current = threads[index]
        let summary = PreviewSummary(
            headline: preview.summary,
            changedFilesCount: preview.changedFilesCount,
            testsPassed: preview.testsPassed,
            testsFailed: preview.testsFailed,
            needsDesktopReview: preview.needsDesktopReview || preview.testsFailed > 0
        )

        threads[index] = ThreadSummary(
            id: current.id,
            projectName: current.projectName,
            projectPath: current.projectPath,
            branchOrWorktree: current.branchOrWorktree,
            title: current.title,
            status: current.status,
            startedAt: current.startedAt,
            updatedAt: .now,
            pendingApprovals: current.pendingApprovals,
            elapsedSeconds: current.elapsedSeconds,
            previewSummary: summary
        )
    }

    private func updateApproval(_ approval: ApprovalRequest) {
        if var detail = threadDetails[approval.threadID] {
            let approvals = [approval] + detail.approvals.filter { $0.id != approval.id }
            detail = ThreadDetail(
                thread: detail.thread,
                latestPlan: detail.latestPlan,
                latestSummary: detail.latestSummary,
                preview: detail.preview,
                conversation: detail.conversation,
                events: detail.events,
                approvals: approvals.sorted(by: { $0.createdAt > $1.createdAt }),
                latestRawLog: detail.latestRawLog
            )
            threadDetails[approval.threadID] = detail
        }

        if let index = threads.firstIndex(where: { $0.id == approval.threadID }) {
            let current = threads[index]
            let pendingCount = detail(for: approval.threadID)?.approvals.filter { $0.status == .pending }.count ?? max(current.pendingApprovals + (approval.status == .pending ? 1 : -1), 0)
            threads[index] = ThreadSummary(
                id: current.id,
                projectName: current.projectName,
                projectPath: current.projectPath,
                branchOrWorktree: current.branchOrWorktree,
                title: current.title,
                status: approval.status == .pending ? .blocked : current.status,
                startedAt: current.startedAt,
                updatedAt: .now,
                pendingApprovals: pendingCount,
                elapsedSeconds: current.elapsedSeconds,
                previewSummary: current.previewSummary
            )
        }
    }

    private func append(event: ThreadEvent) {
        if var detail = threadDetails[event.threadID] {
            detail = ThreadDetail(
                thread: detail.thread,
                latestPlan: detail.latestPlan,
                latestSummary: detail.latestSummary,
                preview: detail.preview,
                conversation: detail.conversation,
                events: [event] + detail.events,
                approvals: detail.approvals,
                latestRawLog: detail.latestRawLog
            )
            threadDetails[event.threadID] = detail
        }
    }

    private func markThread(_ threadID: String, status: ThreadStatus) {
        guard let index = threads.firstIndex(where: { $0.id == threadID }) else { return }
        let current = threads[index]
        threads[index] = ThreadSummary(
            id: current.id,
            projectName: current.projectName,
            projectPath: current.projectPath,
            branchOrWorktree: current.branchOrWorktree,
            title: current.title,
            status: status,
            startedAt: current.startedAt,
            updatedAt: .now,
            pendingApprovals: current.pendingApprovals,
            elapsedSeconds: current.elapsedSeconds,
            previewSummary: current.previewSummary
        )
    }

    private func detail(for threadID: String) -> ThreadDetail? {
        threadDetails[threadID]
    }

    private func refreshDetailIfLoaded(threadID: String) {
        guard threadDetails[threadID] != nil else { return }
        refreshDetailSoon(threadID: threadID)
    }

    private func refreshDetailSoon(threadID: String) {
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            await self?.loadDetail(for: threadID)
        }
    }

    private func startRealtimeConnection(using context: APISessionContext) {
        reconnectTask?.cancel()
        reconnectTask = nil
        realtime.connect(baseURL: context.baseURL, accessToken: context.accessToken)
        connectionBanner = .connected
    }

    private func scheduleReconnect(because error: Error?) async {
        guard isPaired else { return }
        reconnectAttempts += 1
        connectionBanner = reconnectAttempts > 2 ? .stale : .reconnecting
        let delay = ReconnectPolicy.delay(for: reconnectAttempts)
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self else { return }
            do {
                try await self.refreshEverything(connectRealtime: true)
            } catch {
                self.errorMessage = error.localizedDescription
                self.connectionBanner = .offline
            }
        }
    }

    private func preloadImportantDetails() async throws {
        let candidates = Set(
            threads.filter { $0.pendingApprovals > 0 || $0.id == selectedLiveThreadID }
                .map(\.id)
                + (threads.first.map { [$0.id] } ?? [])
        )

        for threadID in candidates {
            let detail = try await withAuthorizedContext { context in
                try await apiClient.fetchThreadDetail(threadID: threadID, using: context)
            }
            threadDetails[threadID] = detail
        }
    }

    private func currentContext() async throws -> APISessionContext {
        guard let metadata = try metadataStore.load() else {
            throw APIError.server("Pair with a Desktop Helper first.")
        }

        try validateHelperURL(metadata.baseURL)

        guard var tokens = try tokenStore.loadTokens() else {
            throw APIError.unauthorized
        }

        if tokens.expiresAt <= .now.addingTimeInterval(60) {
            tokens = try await apiClient.refreshTokens(baseURL: metadata.baseURL, refreshToken: tokens.refreshToken)
            try tokenStore.save(tokens: tokens)
        }

        return APISessionContext(baseURL: metadata.baseURL, accessToken: tokens.accessToken)
    }

    private func validateHelperURL(_ url: URL) throws {
        #if targetEnvironment(simulator)
        return
        #else
        if let host = url.host?.lowercased(), host == "localhost" || host == "127.0.0.1" {
            throw HelperURLError.localhostOnPhysicalDevice
        }
        #endif
    }

    private func persistCache() async throws {
        try await cacheStore.save(
            CachedCompanionState(
                threads: threads,
                threadDetails: threadDetails,
                health: health,
                savedAt: .now
            )
        )
    }

    private func loadCachedState() async {
        do {
            if let cached = try await cacheStore.load() {
                threads = cached.threads
                threadDetails = cached.threadDetails
                health = cached.health
                connectionBanner = .stale
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func withAuthorizedContext<T>(_ operation: (APISessionContext) async throws -> T) async throws -> T {
        guard let metadata = try metadataStore.load() else {
            throw APIError.server("Pair with a Desktop Helper first.")
        }

        guard let tokens = try tokenStore.loadTokens() else {
            throw APIError.unauthorized
        }

        let initialContext = try await currentContext()
        do {
            return try await operation(initialContext)
        } catch APIError.unauthorized {
            let refreshed = try await apiClient.refreshTokens(baseURL: metadata.baseURL, refreshToken: tokens.refreshToken)
            try tokenStore.save(tokens: refreshed)
            return try await operation(APISessionContext(baseURL: metadata.baseURL, accessToken: refreshed.accessToken))
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}
