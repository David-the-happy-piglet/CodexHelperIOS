import Foundation

public actor CompanionCacheStore {
    private let fileURL: URL

    public init(baseDirectory: URL? = nil) {
        let root = baseDirectory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        self.fileURL = root.appendingPathComponent("codex-companion-cache.json")
    }

    public func load() throws -> CachedCompanionState? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        let data = try Data(contentsOf: fileURL)
        return try JSONDecoder.companionAPI.decode(CachedCompanionState.self, from: data)
    }

    public func save(_ state: CachedCompanionState) throws {
        let data = try JSONEncoder.companionAPI.encode(state)
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: fileURL, options: .atomic)
    }

    public func clear() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }
}

