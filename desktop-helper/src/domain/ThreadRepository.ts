import type {
  ApprovalRequest,
  ArtifactPreview,
  ConnectionHealth,
  ThreadDetail,
  ThreadStatus,
  ThreadSummary,
} from "@codex-companion/protocol";
import type { BridgeThreadSnapshot, BridgeUpdate } from "../bridge/CodexBridge.js";
import { PreviewGenerator } from "./PreviewGenerator.js";
import { elapsedSeconds, nowISO } from "../util/time.js";

interface RepositoryMutation {
  threadID?: string;
  created?: boolean;
}

export class ThreadRepository {
  private readonly details = new Map<string, ThreadDetail>();
  private bridgeHealth: ConnectionHealth["codexBridge"] = "disconnected";
  private lastBridgeSyncAt?: string;

  constructor(private readonly previews = new PreviewGenerator()) {}

  seed(snapshots: BridgeThreadSnapshot[]): void {
    snapshots.forEach((snapshot) => this.apply({ type: "snapshot", snapshot }));
    if (snapshots.length > 0) {
      this.bridgeHealth = "healthy";
      this.lastBridgeSyncAt = nowISO();
    }
  }

  apply(update: BridgeUpdate): RepositoryMutation {
    switch (update.type) {
      case "snapshot":
        return this.upsertSnapshot(update.snapshot);
      case "thread":
        return this.upsertThread(update.thread);
      case "preview":
        this.updatePreview(update.preview);
        return { threadID: update.preview.threadID };
      case "event":
        this.recordEvent(update.event);
        return { threadID: update.event.threadID };
      case "approval":
        this.upsertApproval(update.approval);
        return { threadID: update.approval.threadID };
      case "conversation":
        this.ensureDetail(update.threadID).conversation = update.conversation.slice();
        this.touchThread(update.threadID);
        return { threadID: update.threadID };
      case "summary":
        this.ensureDetail(update.threadID).latestSummary = update.latestSummary;
        this.touchThread(update.threadID);
        return { threadID: update.threadID };
      case "plan":
        this.ensureDetail(update.threadID).latestPlan = update.latestPlan;
        this.touchThread(update.threadID);
        return { threadID: update.threadID };
      case "rawLog":
        this.ensureDetail(update.threadID).latestRawLog = update.latestRawLog;
        this.touchThread(update.threadID);
        return { threadID: update.threadID };
      case "health":
        this.bridgeHealth = update.health;
        this.lastBridgeSyncAt = nowISO();
        return {};
      default:
        return {};
    }
  }

  listThreads(): ThreadSummary[] {
    return [...this.details.values()]
      .map((detail) => this.normalizedDetail(detail).thread)
      .sort((lhs, rhs) => rhs.updatedAt.localeCompare(lhs.updatedAt));
  }

  getThread(id: string): ThreadDetail | undefined {
    const detail = this.details.get(id);
    if (!detail) {
      return undefined;
    }

    return this.normalizedDetail(detail);
  }

  getPreview(id: string): ArtifactPreview | undefined {
    return this.getThread(id)?.preview;
  }

  getApprovalsPending(): number {
    return [...this.details.values()].flatMap((detail) => detail.approvals).filter((approval) => approval.status === "pending").length;
  }

  getRunningTasks(): number {
    return this.listThreads().filter((thread) => thread.status === "running").length;
  }

  getBridgeHealth(): ConnectionHealth["codexBridge"] {
    return this.bridgeHealth;
  }

  getLastBridgeSyncAt(): string | undefined {
    return this.lastBridgeSyncAt;
  }

  private upsertSnapshot(snapshot: BridgeThreadSnapshot): RepositoryMutation {
    const created = !this.details.has(snapshot.thread.id);
    this.details.set(snapshot.thread.id, {
      approvals: snapshot.approvals,
      events: snapshot.events.slice().sort((lhs, rhs) => rhs.timestamp.localeCompare(lhs.timestamp)),
      latestPlan: snapshot.latestPlan,
      latestSummary: snapshot.latestSummary,
      latestRawLog: snapshot.latestRawLog,
      preview: snapshot.preview,
      conversation: snapshot.conversation ?? [],
      thread: snapshot.thread,
    });
    this.bridgeHealth = "healthy";
    this.lastBridgeSyncAt = nowISO();
    return { threadID: snapshot.thread.id, created };
  }

  private upsertThread(thread: ThreadSummary): RepositoryMutation {
    const created = !this.details.has(thread.id);
    const detail = this.ensureDetail(thread.id);
    detail.thread = {
      ...detail.thread,
      ...thread,
    };
    this.bridgeHealth = "healthy";
    this.lastBridgeSyncAt = nowISO();
    return { threadID: thread.id, created };
  }

  private updatePreview(preview: ArtifactPreview): void {
    const detail = this.ensureDetail(preview.threadID);
    detail.preview = preview;
    this.touchThread(preview.threadID);
  }

  private recordEvent(event: ThreadDetail["events"][number]): void {
    const detail = this.ensureDetail(event.threadID);
    detail.events = [event, ...detail.events.filter((existing) => existing.id !== event.id)]
      .sort((lhs, rhs) => rhs.timestamp.localeCompare(lhs.timestamp))
      .slice(0, 200);
    detail.thread.status = this.statusFromEvent(detail.thread.status, event.type);
    detail.thread.updatedAt = event.timestamp;
  }

  private upsertApproval(approval: ApprovalRequest): void {
    const detail = this.ensureDetail(approval.threadID);
    detail.approvals = [approval, ...detail.approvals.filter((existing) => existing.id !== approval.id)]
      .sort((lhs, rhs) => rhs.createdAt.localeCompare(lhs.createdAt));
    this.touchThread(approval.threadID);
  }

  private touchThread(threadID: string): void {
    const detail = this.ensureDetail(threadID);
    detail.thread.updatedAt = nowISO();
    this.lastBridgeSyncAt = nowISO();
  }

  private ensureDetail(threadID: string): ThreadDetail {
    const existing = this.details.get(threadID);
    if (existing) {
      return existing;
    }

    const placeholder: ThreadDetail = {
      thread: {
        id: threadID,
        projectName: "Unknown Project",
        projectPath: process.cwd(),
        branchOrWorktree: "detached",
        title: "Connecting to Codex thread",
        status: "waiting",
        startedAt: nowISO(),
        updatedAt: nowISO(),
        pendingApprovals: 0,
        elapsedSeconds: 0,
        previewSummary: {
          headline: "Waiting for the first preview snapshot.",
          changedFilesCount: 0,
          testsPassed: 0,
          testsFailed: 0,
          needsDesktopReview: false,
        },
      },
      latestPlan: [],
      latestSummary: "Waiting for the helper bridge to populate thread details.",
      preview: {
        threadID,
        changedFilesCount: 0,
        changedFileNames: [],
        testsPassed: 0,
        testsFailed: 0,
        screenshotURLs: [],
        summary: "No artifacts have been published yet.",
        needsDesktopReview: false,
      },
      conversation: [],
      events: [],
      approvals: [],
      latestRawLog: "",
    };

    this.details.set(threadID, placeholder);
    return placeholder;
  }

  private normalizedDetail(detail: ThreadDetail): ThreadDetail {
    const pendingApprovals = detail.approvals.filter((approval) => approval.status === "pending").length;
    const previewSummary = this.previews.buildSummary(detail.preview);

    return {
      ...detail,
      thread: {
        ...detail.thread,
        pendingApprovals,
        elapsedSeconds: elapsedSeconds(detail.thread.startedAt),
        previewSummary,
      },
    };
  }

  private statusFromEvent(current: ThreadStatus, eventType: ThreadDetail["events"][number]["type"]): ThreadStatus {
    switch (eventType) {
      case "task.completed":
        return "done";
      case "task.failed":
        return "error";
      case "approval.requested":
        return "blocked";
      case "approval.resolved":
        return current === "paused" ? current : "running";
      default:
        return current;
    }
  }
}
