import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { basename } from "node:path";
import readline from "node:readline";
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
import { nowISO } from "../util/time.js";
import type { BridgeThreadSnapshot, BridgeUpdate, CodexBridge } from "./CodexBridge.js";

type Listener = (update: BridgeUpdate) => void;
type RPCID = string | number;

type AppThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: Array<"waitingOnApproval" | "waitingOnUserInput"> };

interface AppGitInfo {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
}

interface AppThread {
  id: string;
  forkedFromId: string | null;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: AppThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: unknown;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: AppGitInfo | null;
  name: string | null;
  turns: AppTurn[];
}

interface AppTurn {
  id: string;
  items: AppThreadItem[];
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error: { message: string; additionalDetails: string | null } | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

type AppThreadItem =
  | {
      type: "userMessage";
      id: string;
      content: Array<{ type: string; text?: string }>;
    }
  | {
      type: "agentMessage";
      id: string;
      text: string;
      phase: string | null;
    }
  | {
      type: "plan";
      id: string;
      text: string;
    }
  | {
      type: "reasoning";
      id: string;
      summary: string[];
      content: string[];
    }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      status: "inProgress" | "completed" | "failed" | "declined";
      aggregatedOutput: string | null;
      exitCode: number | null;
      durationMs: number | null;
    }
  | {
      type: "fileChange";
      id: string;
      changes: FileUpdateChange[];
      status: "inProgress" | "completed" | "failed" | "declined";
    }
  | {
      type: string;
      id: string;
      [key: string]: unknown;
    };

interface FileUpdateChange {
  path: string;
  kind: string;
  diff: string;
}

interface ThreadListResponse {
  data: AppThread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

interface ThreadResumeResponse {
  thread: AppThread;
}

interface ThreadReadResponse {
  thread: AppThread;
}

interface TurnStartResponse {
  turn: AppTurn;
}

interface TurnSteerResponse {
  turnId: string;
}

interface ThreadStartResponse {
  thread: AppThread;
}

interface PendingApproval {
  requestID: RPCID;
  method:
    | "item/commandExecution/requestApproval"
    | "item/fileChange/requestApproval"
    | "item/permissions/requestApproval"
    | "applyPatchApproval"
    | "execCommandApproval";
  approval: ApprovalRequest;
  params: Record<string, unknown>;
}

interface AppTurnState {
  turn: AppTurn;
  items: AppThreadItem[];
}

interface AppThreadState {
  appThread: AppThread;
  loadedInRuntime: boolean;
  turns: Map<string, AppTurnState>;
  activeTurnID?: string;
  latestPlan: string[];
  latestSummary: string;
  latestRawLog: string;
  approvals: Map<string, ApprovalRequest>;
  pendingApprovals: Map<string, PendingApproval>;
  partialAgentMessages: Map<string, string>;
  events: ThreadEvent[];
  needsDesktopReview: boolean;
  desktopReviewReason?: string;
  localStatusOverride?: ThreadSummary["status"];
}

interface RPCSuccess {
  id: RPCID;
  result: unknown;
}

interface RPCFailure {
  id: RPCID;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface RPCNotification {
  method: string;
  params?: Record<string, unknown>;
}

interface RPCRequest {
  id: RPCID;
  method: string;
  params?: Record<string, unknown>;
}

interface AppServerRPCOptions {
  command: string;
  args: string[];
  cwd: string;
  logger: Logger;
}

interface AppServerCodexBridgeOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  logger: Logger;
  threadLimit?: number;
}

interface PendingRPCRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

class AppServerRPCClient {
  private readonly pending = new Map<string, PendingRPCRequest<any>>();
  private readonly nextIDBase = Date.now();
  private nextID = 1;
  private child?: ChildProcessWithoutNullStreams;
  private stopping = false;

  constructor(
    private readonly options: AppServerRPCOptions,
    private readonly onNotification: (message: RPCNotification) => void,
    private readonly onServerRequest: (message: RPCRequest) => void,
    private readonly onExit: (error?: Error) => void,
  ) {}

  async start(): Promise<void> {
    this.child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.child.once("error", (error) => this.handleExit(error));
    this.child.once("exit", (code, signal) => {
      if (this.stopping) {
        this.handleExit();
        return;
      }
      this.handleExit(new Error(`Codex App Server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`));
    });

    const stdout = readline.createInterface({ input: this.child.stdout });
    stdout.on("line", (line) => this.handleStdout(line));

    const stderr = readline.createInterface({ input: this.child.stderr });
    stderr.on("line", (line) => this.handleStderr(line));

    await this.request("initialize", {
      clientInfo: {
        name: "codex-companion-helper",
        version: "1.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.notify("initialized");
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.child) {
      this.child.kill("SIGTERM");
    }
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Codex App Server was stopped."));
    }
    this.pending.clear();
  }

  async request<T>(method: string, params: Record<string, unknown> | undefined): Promise<T> {
    const id: RPCID = this.nextIDBase + this.nextID;
    this.nextID += 1;
    const key = String(id);

    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return await new Promise<T>((resolve, reject) => {
      this.pending.set(key, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.send(payload);
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.send({
      jsonrpc: "2.0",
      method,
      ...(params ? { params } : {}),
    });
  }

  respond(id: RPCID, result: unknown): void {
    this.send({
      jsonrpc: "2.0",
      id,
      result,
    });
  }

  respondError(id: RPCID, code: number, message: string): void {
    this.send({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    });
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.child?.stdin.writable) {
      throw new Error("Codex App Server stdin is not writable.");
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleStdout(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (error) {
      this.options.logger.warn("app_server_stdout_non_json", {
        line: trimmed,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if ("method" in payload && !("result" in payload) && !("error" in payload)) {
      if ("id" in payload) {
        this.onServerRequest(payload as unknown as RPCRequest);
      } else {
        this.onNotification(payload as unknown as RPCNotification);
      }
      return;
    }

    if ("id" in payload && ("result" in payload || "error" in payload)) {
      const response = payload as unknown as RPCSuccess | RPCFailure;
      const pending = this.pending.get(String(response.id));
      if (!pending) {
        return;
      }
      this.pending.delete(String(response.id));

      if ("error" in response) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private handleStderr(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const payload = JSON.parse(trimmed) as {
        level?: string;
        fields?: Record<string, unknown>;
      };
      const message = typeof payload.fields?.message === "string" ? payload.fields.message : trimmed;
      this.options.logger.warn("app_server_stderr", { line: message });
    } catch {
      this.options.logger.warn("app_server_stderr", { line: trimmed });
    }
  }

  private handleExit(error?: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error ?? new Error("Codex App Server exited."));
    }
    this.pending.clear();
    this.onExit(error);
  }
}

export class AppServerCodexBridge implements CodexBridge {
  readonly mode = "app-server" as const;

  private readonly listeners = new Set<Listener>();
  private readonly states = new Map<string, AppThreadState>();
  private rpc?: AppServerRPCClient;
  private bridgeHealth: "healthy" | "degraded" | "disconnected" = "disconnected";

  constructor(private readonly options: AppServerCodexBridgeOptions) {}

  async connect(): Promise<void> {
    const command = this.options.command ?? "codex";
    const args = this.options.args ?? ["app-server", "--listen", "stdio://"];
    const cwd = this.options.cwd ?? process.cwd();
    const logger = this.options.logger.child({ component: "bridge", mode: "app-server" });

    this.rpc = new AppServerRPCClient(
      { command, args, cwd, logger },
      (notification) => this.handleNotification(notification),
      (request) => this.handleServerRequest(request),
      (error) => {
        this.bridgeHealth = "disconnected";
        if (error) {
          logger.warn("app_server_disconnected", { error: error.message });
        } else {
          logger.info("app_server_disconnected");
        }
        this.emit({ type: "health", health: "disconnected" });
      },
    );

    await this.rpc.start();
    await this.hydrateRecentThreads();
    this.bridgeHealth = "healthy";
    logger.info("app_server_bridge_connected", { command, args, cwd });
    this.emit({ type: "health", health: "healthy" });
  }

  async disconnect(): Promise<void> {
    await this.rpc?.stop();
    this.rpc = undefined;
    this.bridgeHealth = "disconnected";
  }

  async getSnapshots(): Promise<BridgeThreadSnapshot[]> {
    return [...this.states.values()]
      .map((state) => this.toSnapshot(state))
      .sort((lhs, rhs) => rhs.thread.updatedAt.localeCompare(lhs.thread.updatedAt))
      .map(clone);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendCommand(threadID: string, command: ThreadCommandRequest): Promise<void> {
    if (command.type === "review_on_desktop") {
      const state = await this.ensureResumedThread(threadID);
      state.needsDesktopReview = true;
      state.desktopReviewReason = "Mobile escalated this thread for a full desktop review handoff.";
      state.appThread.updatedAt = nowEpochSeconds();
      this.pushEvent(
        state,
        "artifact.generated",
        "Desktop review handoff prepared",
        state.desktopReviewReason,
        "warning",
      );
      this.emit({ type: "preview", preview: this.buildPreview(state) });
      this.emitThreadUpdate(state);
      return;
    }

    const state = await this.ensureResumedThread(threadID);
    if (command.type === "pause") {
      state.localStatusOverride = "paused";
      state.appThread.updatedAt = nowEpochSeconds();
      if (state.activeTurnID) {
        await this.request<Record<string, never>>("turn/interrupt", {
          threadId: threadID,
          turnId: state.activeTurnID,
        });
      }
      this.pushEvent(
        state,
        "task.phase_changed",
        "Paused from iPhone",
        command.note ?? "Codex was interrupted from the companion app.",
        "warning",
      );
      this.emitThreadUpdate(state);
      return;
    }

    const prompt = commandPrompt(command);
    state.localStatusOverride = undefined;

    if (state.activeTurnID) {
      const response = await this.request<TurnSteerResponse>("turn/steer", {
        threadId: threadID,
        expectedTurnId: state.activeTurnID,
        input: [textInput(prompt)],
      });
      state.activeTurnID = response.turnId;
    } else {
      const response = await this.request<TurnStartResponse>("turn/start", {
        threadId: threadID,
        input: [textInput(prompt)],
      });
      state.activeTurnID = response.turn.id;
      state.turns.set(response.turn.id, {
        turn: { ...response.turn, items: [] },
        items: [],
      });
    }

    state.appThread.updatedAt = nowEpochSeconds();
    this.pushEvent(
      state,
      "task.summary_updated",
      "Mobile instruction sent",
      command.note ?? prompt,
      "info",
    );
    this.emitThreadUpdate(state);
  }

  async sendInput(threadID: string, input: ThreadInputRequest): Promise<void> {
    const state = await this.ensureResumedThread(threadID);
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error("Prompt cannot be empty.");
    }

    state.localStatusOverride = undefined;
    if (state.activeTurnID) {
      const response = await this.request<TurnSteerResponse>("turn/steer", {
        threadId: threadID,
        expectedTurnId: state.activeTurnID,
        input: [textInput(prompt)],
      });
      state.activeTurnID = response.turnId;
    } else {
      const response = await this.request<TurnStartResponse>("turn/start", {
        threadId: threadID,
        input: [textInput(prompt)],
      });
      state.activeTurnID = response.turn.id;
      state.turns.set(response.turn.id, {
        turn: { ...response.turn, items: [] },
        items: [],
      });
    }

    state.appThread.updatedAt = nowEpochSeconds();
    state.latestSummary = "Mobile resumed this thread and sent a fresh prompt.";
    this.pushEvent(
      state,
      "task.summary_updated",
      "Mobile prompt sent",
      prompt,
      "info",
    );
    this.emit({ type: "summary", threadID, latestSummary: state.latestSummary });
    this.emitThreadUpdate(state);
  }

  async createThread(input: CreateThreadRequest): Promise<ThreadSummary> {
    const projectPath = input.projectPath.trim();
    const title = input.title.trim() || "New Codex thread";
    if (!projectPath) {
      throw new Error("Project path cannot be empty.");
    }

    const response = await this.request<ThreadStartResponse>("thread/start", {
      cwd: projectPath,
      persistExtendedHistory: true,
      experimentalRawEvents: true,
    });
    if (!response.thread?.id) {
      throw new Error("App Server did not return a new thread.");
    }

    const thread: AppThread = {
      ...response.thread,
      cwd: response.thread.cwd || projectPath,
      turns: response.thread.turns ?? [],
      name: title,
      updatedAt: nowEpochSeconds(),
    };

    await this.request<Record<string, never>>("thread/name/set", {
      threadId: thread.id,
      name: title,
    });

    const state = this.hydrateThread(thread, true, true);
    state.latestSummary = input.initialPrompt?.trim()
      ? "Mobile created a new thread and sent its first prompt."
      : "New mobile-created thread is ready for its first prompt.";
    state.appThread.updatedAt = nowEpochSeconds();
    this.emit({ type: "summary", threadID: thread.id, latestSummary: state.latestSummary });
    this.emitThreadUpdate(state);

    if (input.initialPrompt?.trim()) {
      await this.sendInput(thread.id, { prompt: input.initialPrompt.trim() });
    }

    return clone(this.toSnapshot(this.ensureState(thread.id)).thread);
  }

  async resolveApproval(threadID: string, resolution: ApprovalResolutionRequest): Promise<ApprovalRequest> {
    const state = await this.ensureResumedThread(threadID);
    const pending = state.pendingApprovals.get(resolution.approvalID);
    const approval = state.approvals.get(resolution.approvalID);
    if (!pending || !approval) {
      throw new Error("Approval not found.");
    }

    if (resolution.action === "ask_summary") {
      state.latestSummary = approval.rationale;
      state.appThread.updatedAt = nowEpochSeconds();
      this.emit({ type: "summary", threadID, latestSummary: state.latestSummary });
      this.pushEvent(state, "task.summary_updated", "Approval context summarized", approval.rationale, "info");
      this.emitThreadUpdate(state);
      return clone(approval);
    }

    if (resolution.action === "approve") {
      this.respondToApproval(pending, approval, true);
      approval.status = "approved";
      state.localStatusOverride = undefined;
    } else {
      this.respondToApproval(pending, approval, false);
      approval.status = "rejected";
      state.localStatusOverride = undefined;
    }

    state.pendingApprovals.delete(approval.id);
    state.approvals.set(approval.id, approval);
    state.appThread.updatedAt = nowEpochSeconds();
    this.emit({ type: "approval", approval: clone(approval) });
    this.pushEvent(
      state,
      "approval.resolved",
      resolution.action === "approve" ? "Approval accepted" : "Approval rejected",
      resolution.note ?? "The mobile supervisor resolved the App Server approval request.",
      resolution.action === "approve" ? "success" : "warning",
    );
    this.emitThreadUpdate(state);
    return clone(approval);
  }

  async getHealth(): Promise<"healthy" | "degraded" | "disconnected"> {
    return this.bridgeHealth;
  }

  private async hydrateRecentThreads(): Promise<void> {
    const threads = await this.request<ThreadListResponse>("thread/list", {
      limit: this.options.threadLimit ?? 24,
      sortKey: "updated_at",
      sortDirection: "desc",
      archived: false,
    });

    for (const thread of threads.data) {
      try {
        await this.readThread(thread.id);
      } catch (error) {
        this.options.logger.warn("app_server_thread_read_failed", {
          threadID: thread.id,
          error: error instanceof Error ? error.message : String(error),
        });
        this.hydrateThread(thread, false, false);
      }
    }
  }

  private async ensureResumedThread(threadID: string): Promise<AppThreadState> {
    const existing = this.states.get(threadID);
    if (existing?.loadedInRuntime) {
      return existing;
    }
    await this.resumeThread(threadID);
    const state = this.states.get(threadID);
    if (!state) {
      throw new Error(`Unknown App Server thread: ${threadID}`);
    }
    return state;
  }

  private async readThread(threadID: string): Promise<AppThreadState> {
    const response = await this.request<ThreadReadResponse>("thread/read", {
      threadId: threadID,
      includeTurns: true,
    });
    return this.hydrateThread(response.thread, false, false);
  }

  private async resumeThread(threadID: string): Promise<AppThreadState> {
    try {
      const response = await this.request<ThreadResumeResponse>("thread/resume", {
        threadId: threadID,
        excludeTurns: false,
        persistExtendedHistory: true,
      });
      return this.hydrateThread(response.thread, false, true);
    } catch (error) {
      const fallbackPath = this.states.get(threadID)?.appThread.path;
      if (!fallbackPath) {
        throw error;
      }

      const response = await this.request<ThreadResumeResponse>("thread/resume", {
        threadId: threadID,
        path: fallbackPath,
        excludeTurns: false,
        persistExtendedHistory: true,
      });
      return this.hydrateThread(response.thread, false, true);
    }
  }

  private hydrateThread(thread: AppThread, emitSnapshot: boolean, loadedInRuntime: boolean): AppThreadState {
    const existing = this.states.get(thread.id);
    const state = existing ?? createInitialState(thread);
    state.appThread = { ...thread, turns: [] };
    state.loadedInRuntime = loadedInRuntime || existing?.loadedInRuntime === true;

    if (thread.turns.length > 0) {
      state.turns.clear();
      for (const turn of thread.turns) {
        state.turns.set(turn.id, {
          turn: { ...turn, items: [] },
          items: turn.items.slice(),
        });
      }
      state.activeTurnID = thread.turns.find((candidate) => candidate.status === "inProgress")?.id;
    }

    state.latestSummary = deriveLatestSummary(state) ?? (state.latestSummary || defaultSummaryForThread(thread));
    state.latestPlan = deriveLatestPlan(state);
    state.latestRawLog = deriveLatestRawLog(state) ?? state.latestRawLog;

    if (state.events.length === 0) {
      seedEvents(state, this.buildPreview(state));
    }

    this.states.set(thread.id, state);
    if (emitSnapshot) {
      this.emit({ type: "snapshot", snapshot: this.toSnapshot(state) });
    }
    return state;
  }

  private handleNotification(message: RPCNotification): void {
    this.bridgeHealth = "healthy";

    switch (message.method) {
      case "thread/started": {
        const params = message.params as { thread: AppThread };
        const state = this.hydrateThread(params.thread, true, true);
        this.emitThreadUpdate(state);
        return;
      }
      case "thread/status/changed": {
        const params = message.params as { threadId: string; status: AppThreadStatus };
        const state = this.ensureState(params.threadId);
        state.loadedInRuntime = true;
        state.appThread.status = params.status;
        state.appThread.updatedAt = nowEpochSeconds();
        this.pushEvent(
          state,
          "task.phase_changed",
          humanThreadStatusTitle(params.status),
          humanThreadStatusDetail(params.status),
          params.status.type === "systemError" ? "error" : "info",
        );
        this.emitThreadUpdate(state);
        return;
      }
      case "turn/started": {
        const params = message.params as { threadId: string; turn: AppTurn };
        const state = this.ensureState(params.threadId);
        state.loadedInRuntime = true;
        state.activeTurnID = params.turn.id;
        state.localStatusOverride = undefined;
        state.turns.set(params.turn.id, { turn: { ...params.turn, items: [] }, items: [] });
        state.appThread.updatedAt = nowEpochSeconds();
        this.pushEvent(
          state,
          "task.phase_changed",
          "Turn started",
          "Codex started a new App Server turn.",
          "info",
        );
        this.emitThreadUpdate(state);
        return;
      }
      case "turn/plan/updated": {
        const params = message.params as {
          threadId: string;
          turnId: string;
          explanation: string | null;
          plan: Array<{ step: string; status: string }>;
        };
        const state = this.ensureState(params.threadId);
        state.loadedInRuntime = true;
        state.latestPlan = params.plan.map((step) => decoratePlanStep(step.step, step.status));
        state.appThread.updatedAt = nowEpochSeconds();
        this.emit({ type: "plan", threadID: params.threadId, latestPlan: state.latestPlan.slice() });
        this.pushEvent(
          state,
          "task.phase_changed",
          "Plan updated",
          params.explanation ?? "Codex published a fresh execution plan.",
          "info",
        );
        this.emitThreadUpdate(state);
        return;
      }
      case "item/started": {
        const params = message.params as { threadId: string; turnId: string; item: AppThreadItem };
        const state = this.ensureState(params.threadId);
        state.loadedInRuntime = true;
        const turn = this.ensureTurn(state, params.turnId);
        upsertItem(turn.items, params.item);
        if (isAgentMessageItem(params.item)) {
          state.partialAgentMessages.set(params.item.id, params.item.text);
        } else if (isCommandExecutionItem(params.item)) {
          this.pushEvent(
            state,
            "task.phase_changed",
            "Running command",
            shortCommand(params.item.command),
            "info",
          );
        }
        state.appThread.updatedAt = nowEpochSeconds();
        this.emitConversation(state);
        this.emitThreadUpdate(state);
        return;
      }
      case "item/agentMessage/delta": {
        const params = message.params as { threadId: string; itemId: string; delta: string };
        const state = this.ensureState(params.threadId);
        state.loadedInRuntime = true;
        const next = `${state.partialAgentMessages.get(params.itemId) ?? ""}${params.delta}`;
        state.partialAgentMessages.set(params.itemId, next);
        state.latestSummary = next;
        state.appThread.updatedAt = nowEpochSeconds();
        this.emit({ type: "summary", threadID: params.threadId, latestSummary: state.latestSummary });
        this.emitConversation(state);
        this.emitThreadUpdate(state);
        return;
      }
      case "item/commandExecution/outputDelta": {
        const params = message.params as { threadId: string; turnId: string; itemId: string; delta: string };
        const state = this.ensureState(params.threadId);
        state.loadedInRuntime = true;
        const turn = this.ensureTurn(state, params.turnId);
        const item = turn.items.find((candidate) => candidate.id === params.itemId);
        if (item && isCommandExecutionItem(item)) {
          item.aggregatedOutput = `${item.aggregatedOutput ?? ""}${params.delta}`;
        }
        state.latestRawLog = clipText(`${state.latestRawLog}\n${params.delta}`.trim(), 4_000);
        state.appThread.updatedAt = nowEpochSeconds();
        this.emitConversation(state);
        return;
      }
      case "item/fileChange/patchUpdated": {
        const params = message.params as { threadId: string; turnId: string; itemId: string; changes: FileUpdateChange[] };
        const state = this.ensureState(params.threadId);
        state.loadedInRuntime = true;
        const turn = this.ensureTurn(state, params.turnId);
        const item = turn.items.find((candidate) => candidate.id === params.itemId);
        if (item?.type === "fileChange") {
          item.changes = params.changes;
        }
        state.appThread.updatedAt = nowEpochSeconds();
        this.emitConversation(state);
        this.emit({ type: "preview", preview: this.buildPreview(state) });
        this.emitThreadUpdate(state);
        return;
      }
      case "item/completed": {
        const params = message.params as { threadId: string; turnId: string; item: AppThreadItem };
        const state = this.ensureState(params.threadId);
        state.loadedInRuntime = true;
        const turn = this.ensureTurn(state, params.turnId);
        upsertItem(turn.items, params.item);
        this.handleCompletedItem(state, params.turnId, params.item);
        state.appThread.updatedAt = nowEpochSeconds();
        this.emitConversation(state);
        this.emitThreadUpdate(state);
        return;
      }
      case "turn/completed": {
        const params = message.params as { threadId: string; turn: AppTurn };
        const state = this.ensureState(params.threadId);
        state.loadedInRuntime = true;
        const turn = this.ensureTurn(state, params.turn.id);
        turn.turn = { ...turn.turn, ...params.turn, items: [] };
        if (state.activeTurnID === params.turn.id) {
          state.activeTurnID = undefined;
        }
        state.appThread.updatedAt = nowEpochSeconds();

        if (params.turn.status === "failed") {
          if (params.turn.error?.message) {
            state.latestSummary = params.turn.error.message;
            this.emit({ type: "summary", threadID: params.threadId, latestSummary: state.latestSummary });
          }
          this.pushEvent(
            state,
            "task.failed",
            "Turn failed",
            params.turn.error?.message ?? "Codex reported a turn failure.",
            "error",
          );
        } else if (params.turn.status === "interrupted") {
          this.pushEvent(
            state,
            "task.phase_changed",
            "Turn interrupted",
            "Codex stopped after a mobile pause request.",
            "warning",
          );
        } else {
          this.pushEvent(
            state,
            "task.completed",
            "Turn completed",
            "Codex finished the latest turn successfully.",
            "success",
          );
        }

        this.emitConversation(state);
        this.emitThreadUpdate(state);
        return;
      }
      case "serverRequest/resolved": {
        const params = message.params as { threadId: string; requestId: RPCID };
        const state = this.states.get(params.threadId);
        if (!state) {
          return;
        }
        for (const [approvalID, pending] of state.pendingApprovals.entries()) {
          if (pending.requestID === params.requestId) {
            state.pendingApprovals.delete(approvalID);
          }
        }
        this.emitThreadUpdate(state);
        return;
      }
      case "thread/tokenUsage/updated":
      case "account/rateLimits/updated":
      case "mcpServer/startupStatus/updated":
        return;
      default:
        this.options.logger.info("app_server_notification_ignored", { method: message.method });
    }
  }

  private handleCompletedItem(state: AppThreadState, turnID: string, item: AppThreadItem): void {
    if (isAgentMessageItem(item)) {
      state.partialAgentMessages.delete(item.id);
      state.latestSummary = item.text;
      this.emit({ type: "summary", threadID: state.appThread.id, latestSummary: state.latestSummary });
      this.pushEvent(
        state,
        "task.summary_updated",
        "Progress summary updated",
        item.text,
        "info",
      );
    } else if (isPlanItem(item)) {
      state.latestPlan = parsePlanText(item.text);
      this.emit({ type: "plan", threadID: state.appThread.id, latestPlan: state.latestPlan.slice() });
      this.pushEvent(
        state,
        "task.phase_changed",
        "Plan published",
        item.text,
        "info",
      );
    } else if (isCommandExecutionItem(item)) {
      state.latestRawLog = clipText(item.aggregatedOutput ?? state.latestRawLog, 4_000);
      this.emit({ type: "preview", preview: this.buildPreview(state) });
      this.pushEvent(
        state,
        "task.summary_updated",
        item.status === "failed" ? "Command failed" : "Command completed",
        summarizeCommandResult(item),
        item.status === "failed" ? "error" : "success",
      );
    } else if (isFileChangeItem(item)) {
      this.emit({ type: "preview", preview: this.buildPreview(state) });
      this.pushEvent(
        state,
        "artifact.generated",
        "Files updated",
        summarizeFileChangeItem(item),
        item.status === "failed" ? "error" : "success",
      );
    }

    const turn = this.ensureTurn(state, turnID);
    turn.turn.items = [];
  }

  private handleServerRequest(message: RPCRequest): void {
    switch (message.method) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
      case "item/permissions/requestApproval":
      case "applyPatchApproval":
      case "execCommandApproval":
        this.captureApproval(message as RPCRequest & { method: PendingApproval["method"] });
        return;
      default:
        this.handleUnsupportedServerRequest(message);
    }
  }

  private captureApproval(message: RPCRequest & { method: PendingApproval["method"] }): void {
    const params = (message.params ?? {}) as Record<string, unknown>;
    const threadID = String(params.threadId ?? "unknown-thread");
    const state = this.ensureState(threadID);
    state.loadedInRuntime = true;
    const approval = buildApprovalRequest(message.method, params);
    state.approvals.set(approval.id, approval);
    state.pendingApprovals.set(approval.id, {
      requestID: message.id,
      method: message.method as PendingApproval["method"],
      approval,
      params,
    });
    state.needsDesktopReview = false;
    state.appThread.updatedAt = nowEpochSeconds();
    this.emit({ type: "approval", approval: clone(approval) });
    this.pushEvent(
      state,
      "approval.requested",
      approval.title,
      approval.rationale,
      approval.riskLevel === "low" ? "warning" : "error",
    );
    this.emitThreadUpdate(state);
  }

  private handleUnsupportedServerRequest(message: RPCRequest): void {
    const params = (message.params ?? {}) as Record<string, unknown>;
    const threadID = typeof params.threadId === "string" ? params.threadId : "unknown-thread";
    const state = this.ensureState(threadID);
    state.loadedInRuntime = true;
    const summary = `Desktop attention required: App Server requested ${message.method}, which this mobile-safe bridge does not resolve automatically.`;
    state.needsDesktopReview = true;
    state.desktopReviewReason = summary;
    state.latestSummary = summary;
    state.appThread.updatedAt = nowEpochSeconds();
    this.emit({ type: "summary", threadID, latestSummary: summary });
    this.emit({ type: "preview", preview: this.buildPreview(state) });
    this.pushEvent(state, "task.summary_updated", "Desktop input required", summary, "warning");
    this.emitThreadUpdate(state);
    this.rpc?.respondError(message.id, -32601, `${message.method} is not supported by Codex Companion mobile approvals.`);
  }

  private respondToApproval(pending: PendingApproval, approval: ApprovalRequest, approved: boolean): void {
    switch (pending.method) {
      case "item/commandExecution/requestApproval":
        this.rpc?.respond(pending.requestID, {
          decision: approved ? "accept" : "decline",
        });
        break;
      case "item/fileChange/requestApproval":
        this.rpc?.respond(pending.requestID, {
          decision: approved ? "accept" : "decline",
        });
        break;
      case "item/permissions/requestApproval": {
        const permissions = approved
          ? {
              ...(pending.params.permissions as Record<string, unknown> | undefined),
            }
          : {};
        this.rpc?.respond(pending.requestID, {
          permissions,
          scope: "turn",
        });
        break;
      }
      case "applyPatchApproval":
      case "execCommandApproval":
        this.rpc?.respond(pending.requestID, {
          decision: approved ? "approved" : "denied",
        });
        break;
    }
  }

  private ensureState(threadID: string): AppThreadState {
    const existing = this.states.get(threadID);
    if (existing) {
      return existing;
    }

    const placeholder = createInitialState({
      id: threadID,
      forkedFromId: null,
      preview: "",
      ephemeral: false,
      modelProvider: "openai",
      createdAt: nowEpochSeconds(),
      updatedAt: nowEpochSeconds(),
      status: { type: "notLoaded" },
      path: null,
      cwd: this.options.cwd ?? process.cwd(),
      cliVersion: "unknown",
      source: "appServer",
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [],
    });
    this.states.set(threadID, placeholder);
    return placeholder;
  }

  private ensureTurn(state: AppThreadState, turnID: string): AppTurnState {
    const existing = state.turns.get(turnID);
    if (existing) {
      return existing;
    }

    const placeholder: AppTurnState = {
      turn: {
        id: turnID,
        items: [],
        status: "inProgress",
        error: null,
        startedAt: nowEpochSeconds(),
        completedAt: null,
        durationMs: null,
      },
      items: [],
    };
    state.turns.set(turnID, placeholder);
    return placeholder;
  }

  private emitThreadUpdate(state: AppThreadState): void {
    this.emit({ type: "thread", thread: this.toSnapshot(state).thread });
  }

  private buildPreview(state: AppThreadState): ArtifactPreview {
    const relevantTurn = selectRelevantTurn(state);
    const changedFiles = new Map<string, string>();
    let testsPassed = 0;
    let testsFailed = 0;

    if (relevantTurn) {
      for (const item of relevantTurn.items) {
        if (isFileChangeItem(item)) {
          for (const change of item.changes) {
            changedFiles.set(change.path, change.path);
          }
        }
        if (isCommandExecutionItem(item)) {
          const stats = parseTestStats(item.command, item.aggregatedOutput ?? "", item.exitCode, item.status);
          testsPassed += stats.testsPassed;
          testsFailed += stats.testsFailed;
        }
      }
    }

    const approvalsPending = [...state.approvals.values()].filter((approval) => approval.status === "pending").length;
    const summary =
      state.latestSummary ||
      state.desktopReviewReason ||
      buildFallbackPreviewSummary(changedFiles.size, testsPassed, testsFailed, approvalsPending);

    return {
      threadID: state.appThread.id,
      changedFilesCount: changedFiles.size,
      changedFileNames: [...changedFiles.values()].slice(0, 12),
      testsPassed,
      testsFailed,
      screenshotURLs: [],
      summary,
      needsDesktopReview: state.needsDesktopReview || approvalsPending > 0 || testsFailed > 0,
    };
  }

  private buildConversation(state: AppThreadState): ConversationMessage[] {
    const orderedTurns = [...state.turns.values()].sort((lhs, rhs) => {
      const left = lhs.turn.startedAt ?? 0;
      const right = rhs.turn.startedAt ?? 0;
      return left - right;
    });

    const conversation: ConversationMessage[] = [];
    for (const turnState of orderedTurns) {
      const turnTimestamp = turnState.turn.startedAt ?? state.appThread.updatedAt;
      for (const item of turnState.items) {
        const createdAt = epochSecondsToISO(turnTimestamp);
        if (isUserMessageItem(item)) {
          const text = item.content
            .map((part) => (part.text ?? "").trim())
            .filter(Boolean)
            .join("\n");
          if (text) {
            conversation.push({
              id: item.id,
              threadID: state.appThread.id,
              turnID: turnState.turn.id,
              kind: "user",
              state: "completed",
              createdAt,
              title: "User prompt",
              body: text,
              supplemental: [],
            });
          }
          continue;
        }

        if (isAgentMessageItem(item)) {
          const streamingText = state.partialAgentMessages.get(item.id);
          conversation.push({
            id: item.id,
            threadID: state.appThread.id,
            turnID: turnState.turn.id,
            kind: "assistant",
            state: streamingText ? "streaming" : "completed",
            createdAt,
            title: item.phase ? `Codex • ${item.phase}` : "Codex response",
            body: streamingText ?? item.text,
            supplemental: [],
          });
          continue;
        }

        if (isPlanItem(item)) {
          conversation.push({
            id: item.id,
            threadID: state.appThread.id,
            turnID: turnState.turn.id,
            kind: "plan",
            state: "completed",
            createdAt,
            title: "Plan update",
            body: item.text,
            supplemental: parsePlanText(item.text),
          });
          continue;
        }

        if (isReasoningItem(item)) {
          const summary = item.summary.join("\n").trim();
          const content = item.content.join("\n").trim();
          conversation.push({
            id: item.id,
            threadID: state.appThread.id,
            turnID: turnState.turn.id,
            kind: "reasoning",
            state: "completed",
            createdAt,
            title: "Reasoning summary",
            body: summary || content || "Codex recorded internal reasoning.",
            supplemental: item.summary.length > 0 ? item.summary : item.content,
          });
          continue;
        }

        if (isCommandExecutionItem(item)) {
          conversation.push({
            id: item.id,
            threadID: state.appThread.id,
            turnID: turnState.turn.id,
            kind: "command",
            state: item.status === "failed" ? "failed" : item.status === "inProgress" ? "streaming" : "completed",
            createdAt,
            title: shortCommand(item.command),
            body: summarizeCommandResult(item),
            supplemental: item.aggregatedOutput
              ? item.aggregatedOutput.split("\n").map((line) => line.trim()).filter(Boolean).slice(-4)
              : [],
          });
          continue;
        }

        if (isFileChangeItem(item)) {
          conversation.push({
            id: item.id,
            threadID: state.appThread.id,
            turnID: turnState.turn.id,
            kind: "file_change",
            state: item.status === "failed" ? "failed" : item.status === "inProgress" ? "streaming" : "completed",
            createdAt,
            title: "File changes",
            body: summarizeFileChangeItem(item),
            supplemental: item.changes.map((change) => change.path).slice(0, 8),
          });
        }
      }
    }

    return conversation;
  }

  private toSnapshot(state: AppThreadState): BridgeThreadSnapshot {
    const preview = this.buildPreview(state);
    const relevantTurn = selectRelevantTurn(state);
    const threadStatus = mapThreadStatus(state, relevantTurn);
    const title = deriveTitle(state.appThread);
    const branch = state.appThread.gitInfo?.branch ?? "detached";
    const projectName = basename(state.appThread.cwd) || "Codex Project";

    const thread: ThreadSummary = {
      id: state.appThread.id,
      projectName,
      projectPath: state.appThread.cwd,
      branchOrWorktree: branch,
      title,
      status: threadStatus,
      startedAt: epochSecondsToISO(state.appThread.createdAt),
      updatedAt: epochSecondsToISO(state.appThread.updatedAt),
      pendingApprovals: [...state.approvals.values()].filter((approval) => approval.status === "pending").length,
      elapsedSeconds: 0,
      previewSummary: {
        headline: preview.summary,
        changedFilesCount: preview.changedFilesCount,
        testsPassed: preview.testsPassed,
        testsFailed: preview.testsFailed,
        needsDesktopReview: preview.needsDesktopReview,
      },
    };

    return {
      thread,
      latestPlan: state.latestPlan.length > 0 ? state.latestPlan.slice() : deriveLatestPlan(state),
      latestSummary: state.latestSummary || defaultSummaryForThread(state.appThread),
      preview,
      conversation: this.buildConversation(state),
      events: state.events.slice(0, 200),
      approvals: [...state.approvals.values()].sort((lhs, rhs) => rhs.createdAt.localeCompare(lhs.createdAt)),
      latestRawLog: state.latestRawLog,
    };
  }

  private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!this.rpc) {
      throw new Error("Codex App Server is not connected.");
    }
    return await this.rpc.request<T>(method, params);
  }

  private pushEvent(
    state: AppThreadState,
    type: ThreadEvent["type"],
    title: string,
    detail: string,
    severity: ThreadEvent["severity"],
  ): void {
    const event: ThreadEvent = {
      id: randomUUID(),
      threadID: state.appThread.id,
      type,
      timestamp: nowISO(),
      title,
      detail,
      severity,
    };
    state.events = [event, ...state.events.filter((candidate) => candidate.id !== event.id)].slice(0, 200);
    this.emit({ type: "event", event: clone(event) });
  }

  private emit(update: BridgeUpdate): void {
    for (const listener of this.listeners) {
      listener(clone(update));
    }
  }

  private emitConversation(state: AppThreadState): void {
    this.emit({
      type: "conversation",
      threadID: state.appThread.id,
      conversation: this.buildConversation(state),
    });
  }
}

function createInitialState(thread: AppThread): AppThreadState {
  return {
    appThread: { ...thread, turns: [] },
    loadedInRuntime: false,
    turns: new Map<string, AppTurnState>(),
    activeTurnID: thread.turns.find((candidate) => candidate.status === "inProgress")?.id,
    latestPlan: [],
    latestSummary: defaultSummaryForThread(thread),
    latestRawLog: "",
    approvals: new Map<string, ApprovalRequest>(),
    pendingApprovals: new Map<string, PendingApproval>(),
    partialAgentMessages: new Map<string, string>(),
    events: [],
    needsDesktopReview: false,
  };
}

function seedEvents(state: AppThreadState, preview: ArtifactPreview): void {
  if (state.latestSummary) {
    state.events.push({
      id: randomUUID(),
      threadID: state.appThread.id,
      type: "task.summary_updated",
      timestamp: epochSecondsToISO(state.appThread.updatedAt),
      title: "Latest summary",
      detail: state.latestSummary,
      severity: "info",
    });
  }

  if (preview.changedFilesCount > 0) {
    state.events.push({
      id: randomUUID(),
      threadID: state.appThread.id,
      type: "artifact.generated",
      timestamp: epochSecondsToISO(state.appThread.updatedAt),
      title: "Artifact preview available",
      detail: preview.summary,
      severity: preview.testsFailed > 0 ? "warning" : "success",
    });
  }
}

function defaultSummaryForThread(thread: AppThread): string {
  return thread.preview?.trim() || "Codex thread is ready for supervision from iPhone.";
}

function epochSecondsToISO(value: number): string {
  return new Date(value * 1_000).toISOString();
}

function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function textInput(text: string): { type: "text"; text: string; text_elements: [] } {
  return {
    type: "text",
    text,
    text_elements: [],
  };
}

function commandPrompt(command: ThreadCommandRequest): string {
  const suffix = command.note ? `\n\nAdditional note from the mobile supervisor: ${command.note}` : "";

  switch (command.type) {
    case "continue":
      return `Continue the current thread from the latest safe point.${suffix}`;
    case "replan":
      return `Replan the current work into a concise three-step plan, then continue with the updated plan.${suffix}`;
    case "summarize":
      return `Summarize the current progress for iPhone supervision in two or three short sentences.${suffix}`;
    case "retry_failed_step":
      return `Retry the latest failed step, then explain whether it succeeded.${suffix}`;
    case "explain_blocker":
      return `Explain the current blocker, the likely next action, and whether desktop review is needed.${suffix}`;
    case "custom":
      return command.note?.trim() || "Provide a concise status update for the current thread.";
    default:
      return command.note?.trim() || "Continue the current task.";
  }
}

function mapThreadStatus(state: AppThreadState, turn: AppTurnState | undefined): ThreadSummary["status"] {
  if (state.localStatusOverride === "paused") {
    return "paused";
  }

  if ([...state.approvals.values()].some((approval) => approval.status === "pending")) {
    return "blocked";
  }

  if (state.appThread.status.type === "systemError") {
    return "error";
  }

  if (state.appThread.status.type === "notLoaded") {
    return "waiting";
  }

  if (state.appThread.status.type === "active") {
    if (state.appThread.status.activeFlags.includes("waitingOnApproval") || state.appThread.status.activeFlags.includes("waitingOnUserInput")) {
      return "blocked";
    }
    return "running";
  }

  if (!turn) {
    return "waiting";
  }

  switch (turn.turn.status) {
    case "failed":
      return "error";
    case "interrupted":
      return "paused";
    case "completed":
      return "done";
    default:
      return "waiting";
  }
}

function deriveTitle(thread: AppThread): string {
  if (thread.name?.trim()) {
    return thread.name.trim();
  }

  const preview = thread.preview.trim();
  if (preview) {
    return preview.length > 72 ? `${preview.slice(0, 69)}...` : preview;
  }

  return "Codex App Server thread";
}

function selectRelevantTurn(state: AppThreadState): AppTurnState | undefined {
  if (state.activeTurnID) {
    return state.turns.get(state.activeTurnID);
  }

  return [...state.turns.values()].sort((lhs, rhs) => {
    const lhsTime = lhs.turn.completedAt ?? lhs.turn.startedAt ?? 0;
    const rhsTime = rhs.turn.completedAt ?? rhs.turn.startedAt ?? 0;
    return rhsTime - lhsTime;
  })[0];
}

function deriveLatestSummary(state: AppThreadState): string | undefined {
  for (const turn of [...state.turns.values()].sort((lhs, rhs) => {
    const lhsTime = lhs.turn.completedAt ?? lhs.turn.startedAt ?? 0;
    const rhsTime = rhs.turn.completedAt ?? rhs.turn.startedAt ?? 0;
    return rhsTime - lhsTime;
  })) {
    for (const item of [...turn.items].reverse()) {
      if (isAgentMessageItem(item) && item.text.trim()) {
        return item.text.trim();
      }
      if (isReasoningItem(item) && item.summary.length > 0) {
        return item.summary.join(" ");
      }
    }
  }
  return undefined;
}

function deriveLatestPlan(state: AppThreadState): string[] {
  if (state.latestPlan.length > 0) {
    return state.latestPlan.slice();
  }

  for (const turn of [...state.turns.values()].sort((lhs, rhs) => {
    const lhsTime = lhs.turn.completedAt ?? lhs.turn.startedAt ?? 0;
    const rhsTime = rhs.turn.completedAt ?? rhs.turn.startedAt ?? 0;
    return rhsTime - lhsTime;
  })) {
    for (const item of [...turn.items].reverse()) {
      if (isPlanItem(item)) {
        return parsePlanText(item.text);
      }
    }
  }
  return [];
}

function deriveLatestRawLog(state: AppThreadState): string | undefined {
  for (const turn of [...state.turns.values()].sort((lhs, rhs) => {
    const lhsTime = lhs.turn.completedAt ?? lhs.turn.startedAt ?? 0;
    const rhsTime = rhs.turn.completedAt ?? rhs.turn.startedAt ?? 0;
    return rhsTime - lhsTime;
  })) {
    for (const item of [...turn.items].reverse()) {
      if (isCommandExecutionItem(item) && item.aggregatedOutput?.trim()) {
        return clipText(item.aggregatedOutput.trim(), 4_000);
      }
    }
  }
  return undefined;
}

function parsePlanText(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*0-9.]+\s*/, "").trim())
    .filter(Boolean);
  return lines.length > 0 ? lines.slice(0, 6) : [text.trim()].filter(Boolean);
}

function decoratePlanStep(step: string, status: string): string {
  if (!status || status === "pending") {
    return step;
  }
  return `[${status}] ${step}`;
}

function upsertItem(items: AppThreadItem[], item: AppThreadItem): void {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = item;
    return;
  }
  items.push(item);
}

function humanThreadStatusTitle(status: AppThreadStatus): string {
  switch (status.type) {
    case "active":
      if (status.activeFlags.includes("waitingOnApproval")) {
        return "Waiting on approval";
      }
      if (status.activeFlags.includes("waitingOnUserInput")) {
        return "Waiting on user input";
      }
      return "Thread running";
    case "idle":
      return "Thread idle";
    case "systemError":
      return "Thread error";
    case "notLoaded":
      return "Thread loading";
  }
}

function humanThreadStatusDetail(status: AppThreadStatus): string {
  switch (status.type) {
    case "active":
      if (status.activeFlags.includes("waitingOnApproval")) {
        return "Codex is waiting for a human approval before it can continue.";
      }
      if (status.activeFlags.includes("waitingOnUserInput")) {
        return "Codex is waiting for extra user input that should be handled on desktop.";
      }
      return "Codex is actively working on the current turn.";
    case "idle":
      return "Codex is waiting for the next instruction.";
    case "systemError":
      return "The App Server reported a thread-level system error.";
    case "notLoaded":
      return "The thread metadata is still loading into App Server memory.";
  }
}

function buildApprovalRequest(method: PendingApproval["method"], params: Record<string, unknown>): ApprovalRequest {
  const approvalID = typeof params.approvalId === "string" && params.approvalId ? params.approvalId : randomUUID();
  const threadID = String(params.threadId ?? "unknown-thread");
  const command = typeof params.command === "string" ? params.command : null;
  const reason = typeof params.reason === "string" ? params.reason : null;

  switch (method) {
    case "item/commandExecution/requestApproval":
      return {
        id: approvalID,
        threadID,
        title: command ? `Approve command: ${shortCommand(command)}` : "Approve command execution",
        rationale: reason ?? "Codex requested approval before running a shell command through App Server.",
        riskLevel: "low",
        createdAt: nowISO(),
        status: "pending",
      };
    case "item/fileChange/requestApproval":
      return {
        id: approvalID,
        threadID,
        title: "Approve file changes",
        rationale: reason ?? "Codex requested approval before applying file changes through App Server.",
        riskLevel: "low",
        createdAt: nowISO(),
        status: "pending",
      };
    case "item/permissions/requestApproval":
      return {
        id: approvalID,
        threadID,
        title: "Approve extra permissions",
        rationale: reason ?? "Codex requested extra network or filesystem permissions for this turn.",
        riskLevel: "medium",
        createdAt: nowISO(),
        status: "pending",
      };
    case "applyPatchApproval":
      return {
        id: approvalID,
        threadID,
        title: "Approve patch application",
        rationale: "Codex requested approval before applying a patch to the workspace.",
        riskLevel: "low",
        createdAt: nowISO(),
        status: "pending",
      };
    case "execCommandApproval":
      return {
        id: approvalID,
        threadID,
        title: command ? `Approve command: ${shortCommand(command)}` : "Approve shell command",
        rationale: reason ?? "Codex requested approval before executing a command.",
        riskLevel: "low",
        createdAt: nowISO(),
        status: "pending",
      };
  }
}

function buildFallbackPreviewSummary(
  changedFilesCount: number,
  testsPassed: number,
  testsFailed: number,
  approvalsPending: number,
): string {
  if (approvalsPending > 0) {
    return "Codex is waiting on a low-risk approval before the current turn can continue.";
  }
  if (testsFailed > 0) {
    return `Codex touched ${changedFilesCount} files and the latest test command reported ${testsFailed} failures.`;
  }
  if (changedFilesCount > 0) {
    return `Codex updated ${changedFilesCount} files in the latest App Server turn and has ${testsPassed} passing test signals.`;
  }
  return "Codex is ready for the next supervision step.";
}

function summarizeCommandResult(item: Extract<AppThreadItem, { type: "commandExecution" }>): string {
  const status = item.status === "failed" ? "failed" : "completed";
  const command = shortCommand(item.command);
  const output = item.aggregatedOutput?.trim();
  if (!output) {
    return `${command} ${status}.`;
  }
  return `${command} ${status}. ${clipText(singleLine(output), 220)}`;
}

function summarizeFileChangeItem(item: Extract<AppThreadItem, { type: "fileChange" }>): string {
  if (item.changes.length === 0) {
    return "Codex reported a file-change item with no recorded file paths yet.";
  }
  return `Codex updated ${item.changes.length} file(s): ${item.changes.slice(0, 3).map((change) => change.path).join(", ")}.`;
}

function parseTestStats(
  command: string,
  output: string,
  exitCode: number | null,
  status: "inProgress" | "completed" | "failed" | "declined",
): { testsPassed: number; testsFailed: number } {
  const normalized = `${command}\n${output}`.toLowerCase();
  const looksLikeTest =
    /\b(test|tests|pytest|vitest|jest|mocha|swift test|cargo test|go test|xcodebuild)\b/.test(normalized);

  if (!looksLikeTest) {
    return { testsPassed: 0, testsFailed: 0 };
  }

  const passing = firstMatch(output, /(\d+)\s+passing/i);
  const failing = firstMatch(output, /(\d+)\s+failing/i) ?? firstMatch(output, /(\d+)\s+failed/i);
  if (passing !== undefined || failing !== undefined) {
    return {
      testsPassed: passing ?? 0,
      testsFailed: failing ?? 0,
    };
  }

  if (status === "failed" || (exitCode !== null && exitCode !== 0)) {
    return { testsPassed: 0, testsFailed: 1 };
  }

  return { testsPassed: 1, testsFailed: 0 };
}

function firstMatch(text: string, regex: RegExp): number | undefined {
  const match = regex.exec(text);
  if (!match?.[1]) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function shortCommand(command: string): string {
  const compact = singleLine(command);
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
}

function isUserMessageItem(item: AppThreadItem): item is Extract<AppThreadItem, { type: "userMessage" }> {
  return item.type === "userMessage" && Array.isArray(item.content);
}

function isAgentMessageItem(item: AppThreadItem): item is Extract<AppThreadItem, { type: "agentMessage" }> {
  return item.type === "agentMessage" && typeof item.text === "string";
}

function isCommandExecutionItem(item: AppThreadItem): item is Extract<AppThreadItem, { type: "commandExecution" }> {
  return item.type === "commandExecution" && typeof item.command === "string";
}

function isFileChangeItem(item: AppThreadItem): item is Extract<AppThreadItem, { type: "fileChange" }> {
  return item.type === "fileChange" && Array.isArray(item.changes);
}

function isPlanItem(item: AppThreadItem): item is Extract<AppThreadItem, { type: "plan" }> {
  return item.type === "plan" && typeof item.text === "string";
}

function isReasoningItem(item: AppThreadItem): item is Extract<AppThreadItem, { type: "reasoning" }> {
  return item.type === "reasoning" && Array.isArray(item.summary);
}
