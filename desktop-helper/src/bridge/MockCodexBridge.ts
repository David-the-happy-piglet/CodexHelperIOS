import { randomUUID } from "node:crypto";
import type {
  ApprovalRequest,
  ApprovalResolutionRequest,
  ArtifactPreview,
  ConversationMessage,
  CreateThreadRequest,
  ThreadCommandRequest,
  ThreadEvent,
  ThreadInputRequest,
  ThreadSummary,
} from "@codex-companion/protocol";
import type { Logger } from "../util/logger.js";
import type { BridgeThreadSnapshot, BridgeUpdate, CodexBridge } from "./CodexBridge.js";
import { minutesAgo, nowISO } from "../util/time.js";

type Listener = (update: BridgeUpdate) => void;

interface MockOptions {
  tickIntervalMs?: number;
}

export class MockCodexBridge implements CodexBridge {
  readonly mode = "mock" as const;
  private readonly listeners = new Set<Listener>();
  private readonly threads = new Map<string, BridgeThreadSnapshot>();
  private interval?: NodeJS.Timeout;
  private cycle = 0;

  constructor(
    private readonly logger: Logger,
    private readonly options: MockOptions = {},
  ) {
    for (const snapshot of seedThreads()) {
      this.threads.set(snapshot.thread.id, snapshot);
    }
  }

  async connect(): Promise<void> {
    const tickInterval = this.options.tickIntervalMs ?? 12_000;
    if (tickInterval > 0) {
      this.interval = setInterval(() => {
        void this.advanceSimulation();
      }, tickInterval);
    }

    this.emit({ type: "health", health: "healthy" });
    this.logger.info("mock_bridge_connected");
  }

  async disconnect(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  async getSnapshots(): Promise<BridgeThreadSnapshot[]> {
    return [...this.threads.values()].map(clone);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendCommand(threadID: string, command: ThreadCommandRequest): Promise<void> {
    const snapshot = this.requireThread(threadID);

    switch (command.type) {
      case "pause":
        snapshot.thread.status = "paused";
        this.pushEvent(snapshot, "task.phase_changed", "Paused from iPhone", command.note ?? "Execution is paused until desktop or mobile tells the helper to continue.", "warning");
        break;
      case "continue":
      case "retry_failed_step":
        snapshot.thread.status = "running";
        this.pushEvent(snapshot, "task.phase_changed", "Resumed from iPhone", command.note ?? "Execution resumed after a mobile intervention.", "info");
        break;
      case "replan":
        snapshot.latestPlan = [
          "Validate the current blocker from the local bridge.",
          "Regenerate the artifact preview and approval state.",
          "Publish a concise status summary back to mobile.",
        ];
        this.emit({ type: "plan", threadID, latestPlan: snapshot.latestPlan });
        this.pushEvent(snapshot, "task.summary_updated", "Plan refreshed", command.note ?? "The helper prepared a new three-step recovery plan.", "success");
        break;
      case "summarize":
      case "explain_blocker":
        snapshot.latestSummary =
          command.type === "summarize"
            ? "Codex is still making progress. The latest preview has fresh file counts, a concise test readout, and no large desktop-only review payload."
            : "The thread is blocked on a low-risk approval. Mobile can resolve the approval or hand the code review back to desktop.";
        this.emit({ type: "summary", threadID, latestSummary: snapshot.latestSummary });
        this.pushEvent(snapshot, "task.summary_updated", "Updated mobile summary", snapshot.latestSummary, "info");
        break;
      case "review_on_desktop":
        snapshot.preview.needsDesktopReview = true;
        snapshot.preview.summary = "The mobile review path flagged this thread for a full desktop review handoff.";
        this.emit({ type: "preview", preview: clone(snapshot.preview) });
        this.pushEvent(snapshot, "artifact.generated", "Desktop handoff prepared", "This change set is now marked for serious desktop review.", "warning");
        break;
      case "custom":
        this.pushEvent(snapshot, "task.summary_updated", "Custom command received", command.note ?? "A custom mobile command arrived.", "info");
        break;
    }

    snapshot.thread.updatedAt = nowISO();
    this.emit({ type: "thread", thread: clone(snapshot.thread) });
  }

  async sendInput(threadID: string, input: ThreadInputRequest): Promise<void> {
    const snapshot = this.requireThread(threadID);
    const sentAt = nowISO();
    const turnID = `mock-turn-${Date.now()}`;
    snapshot.conversation.push({
      id: randomUUID(),
      threadID,
      turnID,
      kind: "user",
      state: "completed",
      createdAt: sentAt,
      title: "Mobile prompt",
      body: input.prompt,
      supplemental: [],
    });
    snapshot.conversation.push({
      id: randomUUID(),
      threadID,
      turnID,
      kind: "assistant",
      state: "completed",
      createdAt: nowISO(),
      title: "Codex response",
      body: `Mock mode resumed this thread and received your prompt: "${input.prompt}". In a real App Server session, the helper would issue thread/resume and turn/start here.`,
      supplemental: [],
    });
    snapshot.latestSummary = "Mobile sent a new prompt and the mock bridge produced a companion-safe response.";
    snapshot.thread.status = "running";
    snapshot.thread.updatedAt = nowISO();
    this.emit({ type: "conversation", threadID, conversation: clone(snapshot.conversation) });
    this.emit({ type: "summary", threadID, latestSummary: snapshot.latestSummary });
    this.pushEvent(snapshot, "task.summary_updated", "Mobile prompt delivered", input.prompt, "info");
    this.emit({ type: "thread", thread: clone(snapshot.thread) });
  }

  async createThread(input: CreateThreadRequest): Promise<ThreadSummary> {
    const threadID = `thread-${randomUUID()}`;
    const projectName = input.projectPath.split("/").filter(Boolean).at(-1) ?? "New Project";
    const preview: ArtifactPreview = {
      threadID,
      changedFilesCount: 0,
      changedFileNames: [],
      testsPassed: 0,
      testsFailed: 0,
      screenshotURLs: [],
      summary: input.initialPrompt?.trim() || "New mobile-created thread is ready for its first Codex turn.",
      needsDesktopReview: false,
    };
    const snapshot = createSnapshot({
      id: threadID,
      projectName,
      projectPath: input.projectPath,
      branchOrWorktree: "new/thread",
      title: input.title,
      status: "waiting",
      startedAt: nowISO(),
      updatedAt: nowISO(),
      preview,
      latestSummary: input.initialPrompt?.trim() || "New mobile-created thread is ready for its first Codex turn.",
      latestPlan: [],
      approvals: [],
      latestRawLog: "",
    });
    if (input.initialPrompt?.trim()) {
      snapshot.conversation = [
        {
          id: randomUUID(),
          threadID,
          turnID: `mock-turn-${Date.now()}`,
          kind: "user",
          state: "completed",
          createdAt: nowISO(),
          title: "Initial prompt",
          body: input.initialPrompt.trim(),
          supplemental: [],
        },
      ];
    }
    this.threads.set(threadID, snapshot);
    this.emit({ type: "snapshot", snapshot: clone(snapshot) });
    return clone(snapshot.thread);
  }

  async resolveApproval(threadID: string, resolution: ApprovalResolutionRequest): Promise<ApprovalRequest> {
    const snapshot = this.requireThread(threadID);
    const approval = snapshot.approvals.find((candidate) => candidate.id === resolution.approvalID);
    if (!approval) {
      throw new Error("Approval not found.");
    }

    if (resolution.action === "ask_summary") {
      snapshot.latestSummary = `${approval.title}: ${approval.rationale}`;
      this.emit({ type: "summary", threadID, latestSummary: snapshot.latestSummary });
      this.pushEvent(snapshot, "task.summary_updated", "Approval context summarized", snapshot.latestSummary, "info");
      return clone(approval);
    }

    approval.status = resolution.action === "approve" ? "approved" : "rejected";
    snapshot.thread.status = resolution.action === "approve" ? "running" : "blocked";
    snapshot.thread.updatedAt = nowISO();
    this.emit({ type: "approval", approval: clone(approval) });
    this.emit({ type: "thread", thread: clone(snapshot.thread) });
    this.pushEvent(
      snapshot,
      "approval.resolved",
      resolution.action === "approve" ? "Approval accepted" : "Approval rejected",
      resolution.note ?? "The mobile supervisor resolved the queued approval request.",
      resolution.action === "approve" ? "success" : "warning",
    );

    return clone(approval);
  }

  async getHealth(): Promise<"healthy"> {
    return "healthy";
  }

  async advanceSimulation(): Promise<void> {
    const running = [...this.threads.values()].find((thread) => thread.thread.status === "running");
    if (!running) {
      return;
    }

    this.cycle += 1;

    if (this.cycle % 3 === 0) {
      running.preview.changedFilesCount += 1;
      running.preview.changedFileNames = [...running.preview.changedFileNames, `Sources/CompanionFeature${this.cycle}.swift`];
      running.preview.summary = "Codex published another incremental artifact preview after a successful helper tick.";
      this.emit({ type: "preview", preview: clone(running.preview) });
      this.pushEvent(running, "artifact.generated", "Artifact preview refreshed", running.preview.summary, "success");
    } else if (this.cycle % 5 === 0) {
      running.thread.status = "done";
      running.preview.summary = "Task completed cleanly. A desktop review link is available if the user wants a deeper diff pass.";
      running.preview.testsPassed += 3;
      this.emit({ type: "thread", thread: clone(running.thread) });
      this.emit({ type: "preview", preview: clone(running.preview) });
      this.pushEvent(running, "task.completed", "Task completed", running.preview.summary, "success");
    } else {
      running.latestSummary = `Codex is still running the current phase. Mock cycle ${this.cycle} refreshed the compact summary for mobile.`;
      this.emit({ type: "summary", threadID: running.thread.id, latestSummary: running.latestSummary });
      this.pushEvent(running, "task.summary_updated", "Progress checkpoint", running.latestSummary, "info");
    }
  }

  private requireThread(threadID: string): BridgeThreadSnapshot {
    const snapshot = this.threads.get(threadID);
    if (!snapshot) {
      throw new Error(`Unknown thread: ${threadID}`);
    }
    return snapshot;
  }

  private pushEvent(
    snapshot: BridgeThreadSnapshot,
    type: ThreadEvent["type"],
    title: string,
    detail: string,
    severity: ThreadEvent["severity"],
  ): void {
    const event: ThreadEvent = {
      id: randomUUID(),
      threadID: snapshot.thread.id,
      type,
      timestamp: nowISO(),
      title,
      detail,
      severity,
    };

    snapshot.events.unshift(event);
    this.emit({ type: "event", event });
  }

  private emit(update: BridgeUpdate): void {
    for (const listener of this.listeners) {
      listener(clone(update));
    }
  }
}

function seedThreads(): BridgeThreadSnapshot[] {
  const pairingPreview: ArtifactPreview = {
    threadID: "thread-pairing",
    changedFilesCount: 7,
    changedFileNames: [
      "ios/CodexCompanion/Views/Settings/PairingFlowView.swift",
      "ios/CodexCompanion/ViewModels/SettingsViewModel.swift",
      "desktop-helper/src/auth/AuthSessionManager.ts",
    ],
    testsPassed: 12,
    testsFailed: 0,
    screenshotURLs: [
      "https://images.unsplash.com/photo-1516321497487-e288fb19713f?auto=format&fit=crop&w=800&q=60",
    ],
    summary: "Pairing flow is implemented end to end with QR payload generation, token exchange, and device trust state.",
    needsDesktopReview: false,
  };

  const approvalPreview: ArtifactPreview = {
    threadID: "thread-approval",
    changedFilesCount: 14,
    changedFileNames: [
      "desktop-helper/src/app/createServer.ts",
      "ios/CodexCompanionWidget/CodexCompanionWidget.swift",
      "ios/CodexCompanion/Views/Activity/ActivityDashboardView.swift",
    ],
    testsPassed: 8,
    testsFailed: 1,
    screenshotURLs: [],
    summary: "Notification plumbing is ready, but a release-signing approval and one flaky snapshot test still need human help.",
    needsDesktopReview: true,
  };

  return [
    createSnapshot({
      id: "thread-pairing",
      projectName: "Codex Companion for iPhone",
      projectPath: "/Users/wenjie/Documents/CS/Projects/CodexHelper IOS",
      branchOrWorktree: "codex/mobile-pairing",
      title: "Ship pairing and reconnect flow",
      status: "running",
      startedAt: minutesAgo(34),
      updatedAt: minutesAgo(2),
      preview: pairingPreview,
      latestSummary: "Desktop Helper is streaming clean pairing progress to mobile and staying within lightweight control boundaries.",
      latestPlan: [
        "Finalize the pairing code exchange contract.",
        "Pin the helper certificate for mobile sessions.",
        "Publish the live activity status once the socket reconnects.",
      ],
      approvals: [],
      latestRawLog: "[helper] Pairing endpoint returned a fresh code.\n[codex] Waiting for Live Activity asset refresh.",
    }),
    createSnapshot({
      id: "thread-approval",
      projectName: "Codex Companion for iPhone",
      projectPath: "/Users/wenjie/Documents/CS/Projects/CodexHelper IOS",
      branchOrWorktree: "codex/notifications-and-handoff",
      title: "Stabilize notifications and desktop handoff",
      status: "blocked",
      startedAt: minutesAgo(49),
      updatedAt: minutesAgo(4),
      preview: approvalPreview,
      latestSummary: "Mobile can resolve the low-risk approval, but the deeper code review still belongs on desktop.",
      latestPlan: [
        "Confirm the local notification entitlement changes.",
        "Wait for human approval on release-signing adjustments.",
        "Re-run the failing test before handing review back to desktop.",
      ],
      approvals: [
        {
          id: "approval-signing",
          threadID: "thread-approval",
          title: "Update release signing defaults",
          rationale: "The helper needs approval before rotating the local signing profile used for notification testing.",
          riskLevel: "low",
          createdAt: minutesAgo(6),
          status: "pending",
        },
      ],
      latestRawLog: "[helper] Waiting on low-risk approval for release-signing profile.\n[test] One widget snapshot test is flaky on the current seed data.",
    }),
  ];
}

function createSnapshot(input: {
  id: string;
  projectName: string;
  projectPath: string;
  branchOrWorktree: string;
  title: string;
  status: ThreadSummary["status"];
  startedAt: string;
  updatedAt: string;
  preview: ArtifactPreview;
  latestSummary: string;
  latestPlan: string[];
  approvals: ApprovalRequest[];
  latestRawLog: string;
}): BridgeThreadSnapshot {
  const thread: ThreadSummary = {
    id: input.id,
    projectName: input.projectName,
    projectPath: input.projectPath,
    branchOrWorktree: input.branchOrWorktree,
    title: input.title,
    status: input.status,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    pendingApprovals: input.approvals.filter((approval) => approval.status === "pending").length,
    elapsedSeconds: 0,
    previewSummary: {
      headline: input.preview.summary,
      changedFilesCount: input.preview.changedFilesCount,
      testsPassed: input.preview.testsPassed,
      testsFailed: input.preview.testsFailed,
      needsDesktopReview: input.preview.needsDesktopReview,
    },
  };

  return {
    thread,
    latestPlan: input.latestPlan,
    latestSummary: input.latestSummary,
    preview: input.preview,
    conversation: seedConversation(input.id, input.latestSummary),
    approvals: input.approvals,
    events: [
      {
        id: randomUUID(),
        threadID: input.id,
        type: input.approvals.length > 0 ? "approval.requested" : "task.summary_updated",
        timestamp: input.updatedAt,
        title: input.approvals.length > 0 ? "Low-risk approval queued" : "Progress summary published",
        detail: input.latestSummary,
        severity: input.approvals.length > 0 ? "warning" : "info",
      },
    ],
    latestRawLog: input.latestRawLog,
  };
}

function seedConversation(threadID: string, latestSummary: string): ConversationMessage[] {
  return [
    {
      id: randomUUID(),
      threadID,
      turnID: `${threadID}-turn-1`,
      kind: "user",
      state: "completed",
      createdAt: minutesAgo(16),
      title: "User request",
      body: "Keep the mobile experience lightweight, synced, and safe for supervision.",
      supplemental: [],
    },
    {
      id: randomUUID(),
      threadID,
      turnID: `${threadID}-turn-1`,
      kind: "assistant",
      state: "completed",
      createdAt: minutesAgo(15),
      title: "Codex update",
      body: latestSummary,
      supplemental: [],
    },
  ];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
