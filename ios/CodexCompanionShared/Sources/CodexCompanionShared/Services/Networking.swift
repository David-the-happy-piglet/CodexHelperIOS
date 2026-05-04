import Foundation
import Security

public struct APISessionContext: Sendable {
    public let baseURL: URL
    public let accessToken: String

    public init(baseURL: URL, accessToken: String) {
        self.baseURL = baseURL
        self.accessToken = accessToken
    }
}

public final class PinnedNetworkSessionProvider: NSObject {
    public let session: URLSession
    private let delegateProxy: CertificatePinningDelegate

    public override init() {
        self.delegateProxy = CertificatePinningDelegate()
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 20
        configuration.waitsForConnectivity = true
        self.session = URLSession(configuration: configuration, delegate: delegateProxy, delegateQueue: nil)
        super.init()
    }
}

private final class CertificatePinningDelegate: NSObject, URLSessionDelegate {
    private let bundledCertificateData: Data? = {
        guard let url = Bundle.module.url(forResource: "DesktopHelperDevCert", withExtension: "cer") else {
            return nil
        }
        return try? Data(contentsOf: url)
    }()

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge) async
        -> (URLSession.AuthChallengeDisposition, URLCredential?)
    {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              let serverCertificate = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leafCertificate = serverCertificate.first,
              let pinned = bundledCertificateData
        else {
            return (.performDefaultHandling, nil)
        }

        let serverData = SecCertificateCopyData(leafCertificate) as Data
        if serverData == pinned {
            return (.useCredential, URLCredential(trust: trust))
        }

        return (.cancelAuthenticationChallenge, nil)
    }
}

public enum APIError: LocalizedError {
    case invalidResponse
    case unauthorized
    case server(String)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "The Desktop Helper returned an invalid response."
        case .unauthorized:
            "The current session is no longer authorized."
        case .server(let message):
            message
        }
    }
}

public final class APIClient: @unchecked Sendable {
    private let session: URLSession

    public init(sessionProvider: PinnedNetworkSessionProvider = PinnedNetworkSessionProvider()) {
        self.session = sessionProvider.session
    }

    public func createPairingCode(baseURL: URL) async throws -> PairingCode {
        var request = URLRequest(url: baseURL.appending(path: "/pairing/code"))
        request.httpMethod = "POST"
        request.httpBody = Data("{}".utf8)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await send(request, expecting: PairingCode.self)
    }

    public func exchangePairingCode(baseURL: URL, request payload: PairingExchangeRequest) async throws -> PairingExchangeResponse {
        var request = URLRequest(url: baseURL.appending(path: "/pairing/exchange"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.companionAPI.encode(payload)
        return try await send(request, expecting: PairingExchangeResponse.self)
    }

    public func refreshTokens(baseURL: URL, refreshToken: String) async throws -> AuthTokens {
        var request = URLRequest(url: baseURL.appending(path: "/auth/refresh"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.companionAPI.encode(RefreshRequest(refreshToken: refreshToken))
        return try await send(request, expecting: AuthTokens.self)
    }

    public func logout(baseURL: URL, refreshToken: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: "/auth/logout"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.companionAPI.encode(RefreshRequest(refreshToken: refreshToken))
        _ = try await send(request)
    }

    public func fetchThreads(using context: APISessionContext) async throws -> ThreadListResponse {
        try await send(authorizedRequest(path: "/threads", context: context), expecting: ThreadListResponse.self)
    }

    public func fetchThreadDetail(threadID: String, using context: APISessionContext) async throws -> ThreadDetail {
        try await send(authorizedRequest(path: "/threads/\(threadID)", context: context), expecting: ThreadDetail.self)
    }

    public func createProject(request payload: CreateProjectRequest, using context: APISessionContext) async throws -> ThreadSummary {
        var request = authorizedRequest(path: "/projects", context: context)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.companionAPI.encode(payload)
        return try await send(request, expecting: ThreadSummary.self)
    }

    public func createThread(request payload: CreateThreadRequest, using context: APISessionContext) async throws -> ThreadSummary {
        var request = authorizedRequest(path: "/threads", context: context)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.companionAPI.encode(payload)
        return try await send(request, expecting: ThreadSummary.self)
    }

    public func fetchPreview(threadID: String, using context: APISessionContext) async throws -> ArtifactPreview {
        try await send(authorizedRequest(path: "/threads/\(threadID)/preview", context: context), expecting: ArtifactPreview.self)
    }

    public func sendCommand(threadID: String, request payload: ThreadCommandRequest, using context: APISessionContext) async throws {
        var request = authorizedRequest(path: "/threads/\(threadID)/command", context: context)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.companionAPI.encode(payload)
        _ = try await send(request)
    }

    public func sendInput(threadID: String, request payload: ThreadInputRequest, using context: APISessionContext) async throws {
        var request = authorizedRequest(path: "/threads/\(threadID)/input", context: context)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.companionAPI.encode(payload)
        _ = try await send(request)
    }

    public func resolveApproval(threadID: String, request payload: ApprovalResolutionRequest, using context: APISessionContext) async throws -> ApprovalRequest {
        var request = authorizedRequest(path: "/threads/\(threadID)/approval", context: context)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.companionAPI.encode(payload)
        return try await send(request, expecting: ApprovalRequest.self)
    }

    public func fetchTrustedDevices(using context: APISessionContext) async throws -> DeviceListResponse {
        try await send(authorizedRequest(path: "/devices", context: context), expecting: DeviceListResponse.self)
    }

    public func revokeDevice(deviceID: String, using context: APISessionContext) async throws -> SessionDevice {
        var request = authorizedRequest(path: "/devices/\(deviceID)/revoke", context: context)
        request.httpMethod = "POST"
        return try await send(request, expecting: SessionDevice.self)
    }

    public func fetchHealth(baseURL: URL) async throws -> ConnectionHealth {
        try await send(URLRequest(url: baseURL.appending(path: "/health")), expecting: ConnectionHealth.self)
    }

    private func authorizedRequest(path: String, context: APISessionContext) -> URLRequest {
        var request = URLRequest(url: context.baseURL.appending(path: path))
        request.setValue("Bearer \(context.accessToken)", forHTTPHeaderField: "Authorization")
        return request
    }

    @discardableResult
    private func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if http.statusCode == 401 {
            throw APIError.unauthorized
        }

        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: String])?["error"] ?? "Desktop Helper request failed."
            throw APIError.server(message)
        }

        return data
    }

    private func send<Response: Decodable>(_ request: URLRequest, expecting type: Response.Type) async throws -> Response {
        let data = try await send(request)
        return try JSONDecoder.companionAPI.decode(Response.self, from: data)
    }
}
