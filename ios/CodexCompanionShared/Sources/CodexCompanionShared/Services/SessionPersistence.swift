import Foundation
import Security

public protocol TokenStoring {
    func loadTokens() throws -> AuthTokens?
    func save(tokens: AuthTokens) throws
    func clear() throws
}

public protocol SessionMetadataStoring {
    func load() throws -> SessionMetadata?
    func save(_ metadata: SessionMetadata) throws
    func clear() throws
}

public final class KeychainTokenStore: TokenStoring {
    private let service = "com.codexcompanion.ios.tokens"
    private let account = "desktop-helper-session"

    public init() {}

    public func loadTokens() throws -> AuthTokens? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status != errSecItemNotFound else { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainError.unhandled(status)
        }

        return try JSONDecoder.companionAPI.decode(AuthTokens.self, from: data)
    }

    public func save(tokens: AuthTokens) throws {
        let data = try JSONEncoder.companionAPI.encode(tokens)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        let attributes: [String: Any] = [
            kSecValueData as String: data,
        ]

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            insert[kSecValueData as String] = data
            let addStatus = SecItemAdd(insert as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainError.unhandled(addStatus)
            }
            return
        }

        guard status == errSecSuccess else {
            throw KeychainError.unhandled(status)
        }
    }

    public func clear() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unhandled(status)
        }
    }
}

public final class UserDefaultsSessionMetadataStore: SessionMetadataStoring {
    private let defaults: UserDefaults
    private let key = "codexcompanion.session-metadata"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() throws -> SessionMetadata? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try JSONDecoder.companionAPI.decode(SessionMetadata.self, from: data)
    }

    public func save(_ metadata: SessionMetadata) throws {
        let data = try JSONEncoder.companionAPI.encode(metadata)
        defaults.set(data, forKey: key)
    }

    public func clear() throws {
        defaults.removeObject(forKey: key)
    }
}

public enum KeychainError: Error {
    case unhandled(OSStatus)
}

public final class InMemoryTokenStore: TokenStoring {
    private var tokens: AuthTokens?

    public init(tokens: AuthTokens? = nil) {
        self.tokens = tokens
    }

    public func loadTokens() throws -> AuthTokens? { tokens }
    public func save(tokens: AuthTokens) throws { self.tokens = tokens }
    public func clear() throws { tokens = nil }
}

public final class InMemorySessionMetadataStore: SessionMetadataStoring {
    private var metadata: SessionMetadata?

    public init(metadata: SessionMetadata? = nil) {
        self.metadata = metadata
    }

    public func load() throws -> SessionMetadata? { metadata }
    public func save(_ metadata: SessionMetadata) throws { self.metadata = metadata }
    public func clear() throws { metadata = nil }
}
