import type {
  ApprovalRequest,
  ArtifactPreview,
  ConnectionHealth,
  PairingCode,
  PairingExchangeRequest,
  PairingExchangeResponse,
  RefreshRequest,
  SessionDevice,
  CreateProjectRequest,
  CreateThreadRequest,
  ThreadCommandRequest,
  ThreadDetail,
  ThreadInputRequest,
  ThreadSummary,
} from "./models.js";

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
  "/auth/logout": {
    post: {
      body: RefreshRequest;
      response: {
        ok: true;
      };
    };
  };
  "/devices": {
    get: {
      devices: PairingExchangeResponse["device"][];
    };
  };
  "/devices/:id/revoke": {
    post: SessionDevice;
  };
  "/threads": {
    get: {
      threads: ThreadSummary[];
    };
    post: {
      body: CreateThreadRequest;
      response: ThreadSummary;
    };
  };
  "/projects": {
    post: {
      body: CreateProjectRequest;
      response: ThreadSummary;
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
  "/threads/:id/input": {
    post: {
      body: ThreadInputRequest;
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
