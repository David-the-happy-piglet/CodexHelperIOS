import type {
  ApprovalRequest,
  ApprovalResolutionRequest,
  ArtifactPreview,
  ConnectionHealth,
  ConversationMessage,
  CreateThreadRequest,
  ThreadCommandRequest,
  ThreadDetail,
  ThreadEvent,
  ThreadInputRequest,
  ThreadSummary,
} from "@codex-companion/protocol";

export interface BridgeThreadSnapshot extends Omit<ThreadDetail, "thread"> {
  thread: ThreadSummary;
}

export type BridgeUpdate =
  | { type: "snapshot"; snapshot: BridgeThreadSnapshot }
  | { type: "thread"; thread: ThreadSummary }
  | { type: "preview"; preview: ArtifactPreview }
  | { type: "event"; event: ThreadEvent }
  | { type: "approval"; approval: ApprovalRequest }
  | { type: "conversation"; threadID: string; conversation: ConversationMessage[] }
  | { type: "summary"; threadID: string; latestSummary: string }
  | { type: "plan"; threadID: string; latestPlan: string[] }
  | { type: "rawLog"; threadID: string; latestRawLog: string }
  | { type: "health"; health: ConnectionHealth["codexBridge"] };

export interface CodexBridge {
  readonly mode: "mock" | "filesystem" | "app-server";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getSnapshots(): Promise<BridgeThreadSnapshot[]>;
  subscribe(listener: (update: BridgeUpdate) => void): () => void;
  sendCommand(threadID: string, command: ThreadCommandRequest): Promise<void>;
  sendInput(threadID: string, input: ThreadInputRequest): Promise<void>;
  createThread(input: CreateThreadRequest): Promise<ThreadSummary>;
  resolveApproval(threadID: string, resolution: ApprovalResolutionRequest): Promise<ApprovalRequest>;
  getHealth(): Promise<ConnectionHealth["codexBridge"]>;
}
