import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  ApprovalRequest,
  ApprovalResolutionRequest,
  CreateThreadRequest,
  ThreadSummary,
  ThreadCommandRequest,
  ThreadInputRequest,
} from "@codex-companion/protocol";
import type { Logger } from "../util/logger.js";
import type { BridgeThreadSnapshot, BridgeUpdate, CodexBridge } from "./CodexBridge.js";

type Listener = (update: BridgeUpdate) => void;

export class FileSystemCodexBridge implements CodexBridge {
  readonly mode = "filesystem" as const;
  private readonly listeners = new Set<Listener>();
  private readonly snapshots = new Map<string, BridgeThreadSnapshot>();
  private interval?: NodeJS.Timeout;

  constructor(
    private readonly bridgeRoot: string,
    private readonly logger: Logger,
    private readonly pollIntervalMs = 5_000,
  ) {}

  async connect(): Promise<void> {
    await mkdir(path.join(this.bridgeRoot, "threads"), { recursive: true });
    await this.refresh();
    if (this.pollIntervalMs > 0) {
      this.interval = setInterval(() => {
        void this.refresh();
      }, this.pollIntervalMs);
    }
    this.logger.info("filesystem_bridge_connected", { bridgeRoot: this.bridgeRoot });
  }

  async disconnect(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  async getSnapshots(): Promise<BridgeThreadSnapshot[]> {
    if (this.snapshots.size === 0) {
      await this.refresh();
    }
    return [...this.snapshots.values()].map(clone);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendCommand(threadID: string, command: ThreadCommandRequest): Promise<void> {
    await mkdir(this.bridgeRoot, { recursive: true });
    await appendFile(
      path.join(this.bridgeRoot, "commands.ndjson"),
      JSON.stringify({ threadID, ...command, enqueuedAt: new Date().toISOString() }) + "\n",
      "utf8",
    );
  }

  async sendInput(threadID: string, input: ThreadInputRequest): Promise<void> {
    await mkdir(this.bridgeRoot, { recursive: true });
    await appendFile(
      path.join(this.bridgeRoot, "inputs.ndjson"),
      JSON.stringify({ threadID, ...input, enqueuedAt: new Date().toISOString() }) + "\n",
      "utf8",
    );
  }

  async createThread(_input: CreateThreadRequest): Promise<ThreadSummary> {
    throw new Error("Thread creation is not supported in filesystem bridge mode.");
  }

  async resolveApproval(threadID: string, resolution: ApprovalResolutionRequest): Promise<ApprovalRequest> {
    await mkdir(this.bridgeRoot, { recursive: true });
    await appendFile(
      path.join(this.bridgeRoot, "approvals.ndjson"),
      JSON.stringify({ threadID, ...resolution, resolvedAt: new Date().toISOString() }) + "\n",
      "utf8",
    );

    const snapshot = this.snapshots.get(threadID);
    const approval = snapshot?.approvals.find((candidate) => candidate.id === resolution.approvalID);
    if (!approval) {
      throw new Error("Approval not found.");
    }

    approval.status = resolution.action === "approve" ? "approved" : resolution.action === "reject" ? "rejected" : approval.status;
    this.emit({ type: "approval", approval: clone(approval) });
    return clone(approval);
  }

  async getHealth(): Promise<"healthy" | "degraded" | "disconnected"> {
    if (this.snapshots.size === 0) {
      return "degraded";
    }
    return "healthy";
  }

  private async refresh(): Promise<void> {
    const threadDir = path.join(this.bridgeRoot, "threads");
    const files = (await readdir(threadDir)).filter((file) => file.endsWith(".json"));

    for (const file of files) {
      const contents = await readFile(path.join(threadDir, file), "utf8");
      const snapshot = normalizeSnapshot(JSON.parse(contents) as BridgeThreadSnapshot);
      this.snapshots.set(snapshot.thread.id, snapshot);
      this.emit({ type: "snapshot", snapshot: clone(snapshot) });
    }

    this.emit({ type: "health", health: files.length > 0 ? "healthy" : "degraded" });
  }

  private emit(update: BridgeUpdate): void {
    for (const listener of this.listeners) {
      listener(clone(update));
    }
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeSnapshot(snapshot: BridgeThreadSnapshot): BridgeThreadSnapshot {
  return {
    ...snapshot,
    conversation: snapshot.conversation ?? [],
  };
}
