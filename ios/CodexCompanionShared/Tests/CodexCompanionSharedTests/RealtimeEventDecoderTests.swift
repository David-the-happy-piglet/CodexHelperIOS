import Foundation
import Testing
@testable import CodexCompanionShared

@Test func decodesApprovalRequestedRealtimeEvent() throws {
    let approval = DemoData.approvals[0]
    let payload = RawEventEnvelope(event: .approvalRequested, data: .object([
        "id": .string(approval.id),
        "threadID": .string(approval.threadID),
        "title": .string(approval.title),
        "rationale": .string(approval.rationale),
        "riskLevel": .string(approval.riskLevel.rawValue),
        "createdAt": .string(ISO8601DateFormatter().string(from: approval.createdAt)),
        "status": .string(approval.status.rawValue),
    ]))

    let data = try JSONEncoder.companionAPI.encode(payload)
    let event = try RealtimeEventDecoder.decode(data)

    if case .approvalRequested(let decoded) = event {
        #expect(decoded.id == approval.id)
    } else {
        Issue.record("Expected approvalRequested event")
    }
}

