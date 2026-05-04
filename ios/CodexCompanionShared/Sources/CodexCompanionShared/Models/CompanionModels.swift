import Foundation

public enum ThreadStatus: String, Codable, CaseIterable, Sendable {
    case running
    case waiting
    case blocked
    case error
    case done
    case paused
}

public enum Severity: String, Codable, CaseIterable, Sendable {
    case info
    case warning
    case error
    case success
}

public enum RiskLevel: String, Codable, CaseIterable, Sendable {
    case low
    case medium
    case high
}

public enum ApprovalStatus: String, Codable, CaseIterable, Sendable {
    case pending
    case approved
    case rejected
    case dismissed
}

public enum EventType: String, Codable, CaseIterable, Sendable {
    case threadCreated = "thread.created"
    case threadUpdated = "thread.updated"
    case taskPhaseChanged = "task.phase_changed"
    case taskSummaryUpdated = "task.summary_updated"
    case artifactGenerated = "artifact.generated"
    case approvalRequested = "approval.requested"
    case approvalResolved = "approval.resolved"
    case taskCompleted = "task.completed"
    case taskFailed = "task.failed"
    case connectionHealthChanged = "connection.health_changed"
}

public enum CommandType: String, Codable, CaseIterable, Sendable {
    case `continue`
    case pause
    case replan
    case summarize
    case retryFailedStep = "retry_failed_step"
    case explainBlocker = "explain_blocker"
    case reviewOnDesktop = "review_on_desktop"
    case custom
}

public enum ApprovalAction: String, Codable, CaseIterable, Sendable {
    case approve
    case reject
    case askSummary = "ask_summary"
}

public enum ConversationMessageKind: String, Codable, CaseIterable, Sendable {
    case user
    case assistant
    case plan
    case reasoning
    case command
    case fileChange = "file_change"
    case system
}

public enum ConversationMessageState: String, Codable, CaseIterable, Sendable {
    case pending
    case streaming
    case completed
    case failed
}

public struct PreviewSummary: Codable, Hashable, Sendable {
    public let headline: String
    public let changedFilesCount: Int
    public let testsPassed: Int
    public let testsFailed: Int
    public let needsDesktopReview: Bool

    public init(
        headline: String,
        changedFilesCount: Int,
        testsPassed: Int,
        testsFailed: Int,
        needsDesktopReview: Bool
    ) {
        self.headline = headline
        self.changedFilesCount = changedFilesCount
        self.testsPassed = testsPassed
        self.testsFailed = testsFailed
        self.needsDesktopReview = needsDesktopReview
    }
}

public struct ThreadSummary: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let projectName: String
    public let projectPath: String
    public let branchOrWorktree: String
    public let title: String
    public let status: ThreadStatus
    public let startedAt: Date
    public let updatedAt: Date
    public let pendingApprovals: Int
    public let elapsedSeconds: Int
    public let previewSummary: PreviewSummary

    public init(
        id: String,
        projectName: String,
        projectPath: String,
        branchOrWorktree: String,
        title: String,
        status: ThreadStatus,
        startedAt: Date,
        updatedAt: Date,
        pendingApprovals: Int,
        elapsedSeconds: Int,
        previewSummary: PreviewSummary
    ) {
        self.id = id
        self.projectName = projectName
        self.projectPath = projectPath
        self.branchOrWorktree = branchOrWorktree
        self.title = title
        self.status = status
        self.startedAt = startedAt
        self.updatedAt = updatedAt
        self.pendingApprovals = pendingApprovals
        self.elapsedSeconds = elapsedSeconds
        self.previewSummary = previewSummary
    }
}

public struct ThreadEvent: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let threadID: String
    public let type: EventType
    public let timestamp: Date
    public let title: String
    public let detail: String
    public let severity: Severity

    public init(
        id: String,
        threadID: String,
        type: EventType,
        timestamp: Date,
        title: String,
        detail: String,
        severity: Severity
    ) {
        self.id = id
        self.threadID = threadID
        self.type = type
        self.timestamp = timestamp
        self.title = title
        self.detail = detail
        self.severity = severity
    }
}

public struct ApprovalRequest: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let threadID: String
    public let title: String
    public let rationale: String
    public let riskLevel: RiskLevel
    public let createdAt: Date
    public let status: ApprovalStatus

    public init(
        id: String,
        threadID: String,
        title: String,
        rationale: String,
        riskLevel: RiskLevel,
        createdAt: Date,
        status: ApprovalStatus
    ) {
        self.id = id
        self.threadID = threadID
        self.title = title
        self.rationale = rationale
        self.riskLevel = riskLevel
        self.createdAt = createdAt
        self.status = status
    }
}

public struct ArtifactPreview: Codable, Hashable, Sendable {
    public let threadID: String
    public let changedFilesCount: Int
    public let changedFileNames: [String]
    public let testsPassed: Int
    public let testsFailed: Int
    public let screenshotURLs: [URL]
    public let summary: String
    public let needsDesktopReview: Bool

    public init(
        threadID: String,
        changedFilesCount: Int,
        changedFileNames: [String],
        testsPassed: Int,
        testsFailed: Int,
        screenshotURLs: [URL],
        summary: String,
        needsDesktopReview: Bool
    ) {
        self.threadID = threadID
        self.changedFilesCount = changedFilesCount
        self.changedFileNames = changedFileNames
        self.testsPassed = testsPassed
        self.testsFailed = testsFailed
        self.screenshotURLs = screenshotURLs
        self.summary = summary
        self.needsDesktopReview = needsDesktopReview
    }
}

public struct ConversationMessage: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let threadID: String
    public let turnID: String?
    public let kind: ConversationMessageKind
    public let state: ConversationMessageState
    public let createdAt: Date
    public let title: String
    public let body: String
    public let supplemental: [String]

    public init(
        id: String,
        threadID: String,
        turnID: String? = nil,
        kind: ConversationMessageKind,
        state: ConversationMessageState,
        createdAt: Date,
        title: String,
        body: String,
        supplemental: [String] = []
    ) {
        self.id = id
        self.threadID = threadID
        self.turnID = turnID
        self.kind = kind
        self.state = state
        self.createdAt = createdAt
        self.title = title
        self.body = body
        self.supplemental = supplemental
    }
}

public struct ThreadDetail: Codable, Hashable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case thread
        case latestPlan
        case latestSummary
        case preview
        case conversation
        case events
        case approvals
        case latestRawLog
    }

    public let thread: ThreadSummary
    public let latestPlan: [String]
    public let latestSummary: String
    public let preview: ArtifactPreview
    public let conversation: [ConversationMessage]
    public let events: [ThreadEvent]
    public let approvals: [ApprovalRequest]
    public let latestRawLog: String?

    public init(
        thread: ThreadSummary,
        latestPlan: [String],
        latestSummary: String,
        preview: ArtifactPreview,
        conversation: [ConversationMessage] = [],
        events: [ThreadEvent],
        approvals: [ApprovalRequest],
        latestRawLog: String? = nil
    ) {
        self.thread = thread
        self.latestPlan = latestPlan
        self.latestSummary = latestSummary
        self.preview = preview
        self.conversation = conversation
        self.events = events
        self.approvals = approvals
        self.latestRawLog = latestRawLog
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.thread = try container.decode(ThreadSummary.self, forKey: .thread)
        self.latestPlan = try container.decode([String].self, forKey: .latestPlan)
        self.latestSummary = try container.decode(String.self, forKey: .latestSummary)
        self.preview = try container.decode(ArtifactPreview.self, forKey: .preview)
        self.conversation = try container.decodeIfPresent([ConversationMessage].self, forKey: .conversation) ?? []
        self.events = try container.decode([ThreadEvent].self, forKey: .events)
        self.approvals = try container.decode([ApprovalRequest].self, forKey: .approvals)
        self.latestRawLog = try container.decodeIfPresent(String.self, forKey: .latestRawLog)
    }
}

public struct PairingCode: Codable, Hashable, Sendable {
    public let code: String
    public let expiresAt: Date
    public let helperURL: URL
    public let qrPayload: String
}

public struct PairingExchangeRequest: Codable, Sendable {
    public let deviceName: String
    public let pairingCode: String

    public init(deviceName: String, pairingCode: String) {
        self.deviceName = deviceName
        self.pairingCode = pairingCode
    }
}

public struct AuthTokens: Codable, Hashable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Date

    public init(accessToken: String, refreshToken: String, expiresAt: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
    }
}

public struct SessionDevice: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let pairedAt: Date
    public let lastSeenAt: Date
    public let revokedAt: Date?

    public init(id: String, name: String, pairedAt: Date, lastSeenAt: Date, revokedAt: Date? = nil) {
        self.id = id
        self.name = name
        self.pairedAt = pairedAt
        self.lastSeenAt = lastSeenAt
        self.revokedAt = revokedAt
    }
}

public struct PairingExchangeResponse: Codable, Hashable, Sendable {
    public let device: SessionDevice
    public let tokens: AuthTokens
}

public struct RefreshRequest: Codable, Hashable, Sendable {
    public let refreshToken: String
}

public struct ThreadCommandRequest: Codable, Hashable, Sendable {
    public let type: CommandType
    public let note: String?

    public init(type: CommandType, note: String? = nil) {
        self.type = type
        self.note = note
    }
}

public struct ThreadInputRequest: Codable, Hashable, Sendable {
    public let prompt: String

    public init(prompt: String) {
        self.prompt = prompt
    }
}

public struct CreateProjectRequest: Codable, Hashable, Sendable {
    public let name: String
    public let projectPath: String?
    public let initialThreadTitle: String?
    public let initialPrompt: String?

    public init(name: String, projectPath: String? = nil, initialThreadTitle: String? = nil, initialPrompt: String? = nil) {
        self.name = name
        self.projectPath = projectPath
        self.initialThreadTitle = initialThreadTitle
        self.initialPrompt = initialPrompt
    }
}

public struct CreateThreadRequest: Codable, Hashable, Sendable {
    public let projectPath: String
    public let title: String
    public let initialPrompt: String?

    public init(projectPath: String, title: String, initialPrompt: String? = nil) {
        self.projectPath = projectPath
        self.title = title
        self.initialPrompt = initialPrompt
    }
}

public struct ApprovalResolutionRequest: Codable, Hashable, Sendable {
    public let approvalID: String
    public let action: ApprovalAction
    public let note: String?

    public init(approvalID: String, action: ApprovalAction, note: String? = nil) {
        self.approvalID = approvalID
        self.action = action
        self.note = note
    }
}

public struct ConnectionHealth: Codable, Hashable, Sendable {
    public enum BridgeState: String, Codable, Sendable {
        case healthy
        case degraded
        case disconnected
    }

    public let codexBridge: BridgeState
    public let websocketClients: Int
    public let demoMode: Bool
    public let lastBridgeSyncAt: Date?

    public init(codexBridge: BridgeState, websocketClients: Int, demoMode: Bool, lastBridgeSyncAt: Date? = nil) {
        self.codexBridge = codexBridge
        self.websocketClients = websocketClients
        self.demoMode = demoMode
        self.lastBridgeSyncAt = lastBridgeSyncAt
    }
}

public struct ThreadListResponse: Codable, Hashable, Sendable {
    public let threads: [ThreadSummary]
    public let approvalsPending: Int
    public let runningTasks: Int
    public let health: ConnectionHealth
}

public struct DeviceListResponse: Codable, Hashable, Sendable {
    public let devices: [SessionDevice]
}

public struct PhaseUpdate: Codable, Hashable, Sendable {
    public let threadID: String
    public let latestPlan: [String]
}

public struct SummaryUpdate: Codable, Hashable, Sendable {
    public let threadID: String
    public let latestSummary: String
}

public struct RawLogUpdate: Codable, Hashable, Sendable {
    public let threadID: String
    public let latestRawLog: String
}

public struct HandoffIntent: Identifiable, Hashable, Sendable {
    public let id: String
    public let threadID: String
    public let deeplinkURL: URL

    public init(threadID: String) {
        self.threadID = threadID
        self.id = threadID
        self.deeplinkURL = URL(string: "codexcompanion://desktop/review?thread=\(threadID)")!
    }
}

public enum JSONValue: Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null
}

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let boolValue = try? container.decode(Bool.self) {
            self = .bool(boolValue)
        } else if let numberValue = try? container.decode(Double.self) {
            self = .number(numberValue)
        } else if let stringValue = try? container.decode(String.self) {
            self = .string(stringValue)
        } else if let arrayValue = try? container.decode([JSONValue].self) {
            self = .array(arrayValue)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

public extension JSONValue {
    func decode<T: Decodable>(_ type: T.Type, using decoder: JSONDecoder = .companionAPI) throws -> T {
        let data = try JSONEncoder.companionAPI.encode(self)
        return try decoder.decode(T.self, from: data)
    }
}

public struct RawEventEnvelope: Codable, Sendable {
    public let event: EventType
    public let data: JSONValue
}

public enum RealtimeEvent: Sendable {
    case threadCreated(ThreadSummary)
    case threadUpdated(ThreadSummary)
    case phaseChanged(PhaseUpdate)
    case summaryUpdated(SummaryUpdate)
    case artifactGenerated(ArtifactPreview)
    case approvalRequested(ApprovalRequest)
    case approvalResolved(ApprovalRequest)
    case taskCompleted(ThreadEvent)
    case taskFailed(ThreadEvent)
    case connectionHealthChanged(ConnectionHealth)
}

public enum ConnectionBannerState: String, Sendable {
    case connected
    case reconnecting
    case stale
    case offline
}

public struct CachedCompanionState: Codable, Hashable, Sendable {
    public let threads: [ThreadSummary]
    public let threadDetails: [String: ThreadDetail]
    public let health: ConnectionHealth
    public let savedAt: Date

    public init(threads: [ThreadSummary], threadDetails: [String: ThreadDetail], health: ConnectionHealth, savedAt: Date) {
        self.threads = threads
        self.threadDetails = threadDetails
        self.health = health
        self.savedAt = savedAt
    }
}

public struct SessionMetadata: Codable, Hashable, Sendable {
    public let baseURL: URL
    public let device: SessionDevice

    public init(baseURL: URL, device: SessionDevice) {
        self.baseURL = baseURL
        self.device = device
    }
}

public extension JSONDecoder {
    static var companionAPI: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

public extension JSONEncoder {
    static var companionAPI: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}
