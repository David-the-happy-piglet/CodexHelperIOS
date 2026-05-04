import Testing
@testable import CodexCompanionShared

@Test func parsesDesktopQRPayload() throws {
    let payload = try PairingPayloadParser.parse(
        "codexcompanion://pair?helper=https%3A%2F%2Flocalhost%3A9443&code=ABC123",
        helperURL: nil
    )

    #expect(payload.code == "ABC123")
    #expect(payload.helperURL.absoluteString == "https://localhost:9443")
}

@Test func parsesManualCodeWithFallbackURL() throws {
    let payload = try PairingPayloadParser.parse("abc123", helperURL: "https://192.168.1.4:9443")
    #expect(payload.code == "ABC123")
    #expect(payload.helperURL.absoluteString == "https://192.168.1.4:9443")
}

