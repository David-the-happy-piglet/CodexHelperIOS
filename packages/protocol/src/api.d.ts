import type { ApprovalRequest, ArtifactPreview, ConnectionHealth, PairingCode, PairingExchangeRequest, PairingExchangeResponse, RefreshRequest, ThreadCommandRequest, ThreadDetail, ThreadSummary } from "./models.js";
export interface APIPaths {
    "/health": {
        get: ConnectionHealth;
    };
    "/pairing/code": {
        post: PairingCode;
    };
    "/pairing/exchange": {
        post: {
            body: PairingExchangeRequest;
            response: PairingExchangeResponse;
        };
    };
    "/auth/refresh": {
        post: {
            body: RefreshRequest;
            response: PairingExchangeResponse["tokens"];
        };
    };
    "/threads": {
        get: {
            threads: ThreadSummary[];
        };
    };
    "/threads/:id": {
        get: ThreadDetail;
    };
    "/threads/:id/preview": {
        get: ArtifactPreview;
    };
    "/threads/:id/command": {
        post: {
            body: ThreadCommandRequest;
            response: {
                accepted: boolean;
            };
        };
    };
    "/threads/:id/approval": {
        post: {
            body: {
                approvalID: string;
                action: "approve" | "reject" | "ask_summary";
                note?: string;
            };
            response: ApprovalRequest;
        };
    };
}
