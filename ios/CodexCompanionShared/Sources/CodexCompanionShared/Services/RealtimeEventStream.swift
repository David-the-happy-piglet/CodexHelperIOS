import Foundation

public enum RealtimeEventDecoder {
    public static func decode(_ data: Data) throws -> RealtimeEvent {
        let envelope = try JSONDecoder.companionAPI.decode(RawEventEnvelope.self, from: data)
        switch envelope.event {
        case .threadCreated:
            return .threadCreated(try envelope.data.decode(ThreadSummary.self))
        case .threadUpdated:
            return .threadUpdated(try envelope.data.decode(ThreadSummary.self))
        case .taskPhaseChanged:
            return .phaseChanged(try envelope.data.decode(PhaseUpdate.self))
        case .taskSummaryUpdated:
            return .summaryUpdated(try envelope.data.decode(SummaryUpdate.self))
        case .artifactGenerated:
            return .artifactGenerated(try envelope.data.decode(ArtifactPreview.self))
        case .approvalRequested:
            return .approvalRequested(try envelope.data.decode(ApprovalRequest.self))
        case .approvalResolved:
            return .approvalResolved(try envelope.data.decode(ApprovalRequest.self))
        case .taskCompleted:
            return .taskCompleted(try envelope.data.decode(ThreadEvent.self))
        case .taskFailed:
            return .taskFailed(try envelope.data.decode(ThreadEvent.self))
        case .connectionHealthChanged:
            return .connectionHealthChanged(try envelope.data.decode(ConnectionHealth.self))
        }
    }
}

@MainActor
public final class RealtimeEventStream {
    public var onEvent: ((RealtimeEvent) -> Void)?
    public var onDisconnect: ((Error?) -> Void)?

    private let session: URLSession
    private var task: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?

    public init(sessionProvider: PinnedNetworkSessionProvider = PinnedNetworkSessionProvider()) {
        self.session = sessionProvider.session
    }

    public func connect(baseURL: URL, accessToken: String) {
        disconnect()

        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else { return }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/events"

        guard let url = components.url else { return }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let task = session.webSocketTask(with: request)
        task.resume()
        self.task = task
        receiveTask = Task { @MainActor [weak self] in
            await self?.receiveLoop()
        }
    }

    public func disconnect() {
        receiveTask?.cancel()
        receiveTask = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func receiveLoop() async {
        while let task {
            do {
                let message = try await task.receive()
                let data: Data
                switch message {
                case .data(let payload):
                    data = payload
                case .string(let text):
                    data = Data(text.utf8)
                @unknown default:
                    continue
                }

                let event = try RealtimeEventDecoder.decode(data)
                onEvent?(event)
            } catch {
                if !Task.isCancelled {
                    onDisconnect?(error)
                }
                break
            }
        }
    }
}
