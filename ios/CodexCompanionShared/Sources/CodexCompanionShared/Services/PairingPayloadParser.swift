import Foundation

public struct PairingPayload: Equatable, Sendable {
    public let helperURL: URL
    public let code: String

    public init(helperURL: URL, code: String) {
        self.helperURL = helperURL
        self.code = code
    }
}

public enum PairingPayloadParser {
    public enum ParseError: LocalizedError, Equatable {
        case invalidInput
        case missingHelperURL
        case missingCode

        public var errorDescription: String? {
            switch self {
            case .invalidInput:
                "Enter a valid pairing code or scan a desktop QR payload."
            case .missingHelperURL:
                "A helper URL is required for manual pairing."
            case .missingCode:
                "A pairing code is required to continue."
            }
        }
    }

    public static func parse(_ rawValue: String, helperURL fallbackURL: String?) throws -> PairingPayload {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw ParseError.invalidInput
        }

        if let url = URL(string: trimmed), url.scheme == "codexcompanion" {
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            guard let helper = components?.queryItems?.first(where: { $0.name == "helper" })?.value,
                  let helperURL = URL(string: helper) else {
                throw ParseError.missingHelperURL
            }

            guard let code = components?.queryItems?.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
                throw ParseError.missingCode
            }

            return PairingPayload(helperURL: helperURL, code: code)
        }

        guard let fallbackURL, let helperURL = URL(string: fallbackURL) else {
            throw ParseError.missingHelperURL
        }

        return PairingPayload(helperURL: helperURL, code: trimmed.uppercased())
    }
}

