export type ThreadStatus = "running" | "waiting" | "blocked" | "error" | "done" | "paused";
export type Severity = "info" | "warning" | "error" | "success";
export type RiskLevel = "low" | "medium" | "high";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "dismissed";
export type EventType =
  | "thread.created"
  | "thread.updated"
  | "task.phase_changed"
  | "task.summary_updated"
  | "artifact.generated"
  | "approval.requested"
  | "approval.resolved"
  | "task.completed"
  | "task.failed"
  | "connection.health_changed";

export type CommandType =
  | "continue"
  | "pause"
  | "replan"
  | "summarize"
  | "retry_failed_step"
  | "explain_blocker"
  | "review_on_desktop"
  | "custom";

export type ApprovalAction = "approve" | "reject" | "ask_summary";
export type ConversationMessageKind = "user" | "assistant" | "plan" | "reasoning" | "command" | "file_change" | "system";
export type ConversationMessageState = "pending" | "streaming" | "completed" | "failed";

export interface PreviewSummary {
  headline: string;
  changedFilesCount: number;
  testsPassed: number;
  testsFailed: number;
  needsDesktopReview: boolean;
}

export interface ThreadSummary {
  id: string;
  projectName: string;
  projectPath: string;
  branchOrWorktree: string;
  title: string;
  status: ThreadStatus;
  startedAt: string;
  updatedAt: string;
  pendingApprovals: number;
  elapsedSeconds: number;
  previewSummary: PreviewSummary;
}

export interface ThreadEvent {
  id: string;
  threadID: string;
  type: EventType;
  timestamp: string;
  title: string;
  detail: string;
  severity: Severity;
}

export interface ApprovalRequest {
  id: string;
  threadID: string;
  title: string;
  rationale: string;
  riskLevel: RiskLevel;
  createdAt: string;
  status: ApprovalStatus;
}

export interface ArtifactPreview {
  threadID: string;
  changedFilesCount: number;
  changedFileNames: string[];
  testsPassed: number;
  testsFailed: number;
  screenshotURLs: string[];
  summary: string;
  needsDesktopReview: boolean;
}

export interface ConversationMessage {
  id: string;
  threadID: string;
  turnID?: string;
  kind: ConversationMessageKind;
  state: ConversationMessageState;
  createdAt: string;
  title: string;
  body: string;
  supplemental: string[];
}

export interface ThreadDetail {
  thread: ThreadSummary;
  latestPlan: string[];
  latestSummary: string;
  preview: ArtifactPreview;
  conversation: ConversationMessage[];
  events: ThreadEvent[];
  approvals: ApprovalRequest[];
  latestRawLog?: string;
}

export interface ThreadCommandRequest {
  type: CommandType;
  note?: string;
}

export interface ThreadInputRequest {
  prompt: string;
}

export interface CreateProjectRequest {
  name: string;
  projectPath?: string;
  initialThreadTitle?: string;
  initialPrompt?: string;
}

export interface CreateThreadRequest {
  projectPath: string;
  title: string;
  initialPrompt?: string;
}

export interface ApprovalResolutionRequest {
  approvalID: string;
  action: ApprovalAction;
  note?: string;
}

export interface PairingCode {
  code: string;
  expiresAt: string;
  helperURL: string;
  qrPayload: string;
}

export interface PairingExchangeRequest {
  deviceName: string;
  pairingCode: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface SessionDevice {
  id: string;
  name: string;
  pairedAt: string;
  lastSeenAt: string;
  revokedAt?: string;
}

export interface PairingExchangeResponse {
  device: SessionDevice;
  tokens: AuthTokens;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface DeviceListResponse {
  devices: SessionDevice[];
}

export interface ConnectionHealth {
  codexBridge: "healthy" | "degraded" | "disconnected";
  websocketClients: number;
  demoMode: boolean;
  lastBridgeSyncAt?: string;
}

export interface ListThreadsResponse {
  threads: ThreadSummary[];
  approvalsPending: number;
  runningTasks: number;
  health: ConnectionHealth;
}

export interface EventEnvelope<T = unknown> {
  event: EventType;
  data: T;
}
