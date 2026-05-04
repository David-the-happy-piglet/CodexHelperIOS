import readline from "node:readline";

const scenario = process.argv[2] ?? "basic";
const now = Math.floor(Date.now() / 1000);
const cwd = process.cwd();

let liveTurn = null;
let pendingApprovalRequestID = null;

const historyTurn = {
  id: "turn-history",
  items: [
    {
      type: "fileChange",
      id: "file-change-history",
      changes: [
        {
          path: "ios/CodexCompanion/Views/Settings/PairingFlowView.swift",
          kind: "modified",
          diff: "@@",
        },
        {
          path: "desktop-helper/src/auth/AuthSessionManager.ts",
          kind: "modified",
          diff: "@@",
        },
      ],
      status: "completed",
    },
    {
      type: "commandExecution",
      id: "test-history",
      command: "npm test",
      cwd,
      status: "completed",
      aggregatedOutput: "4 passing",
      exitCode: 0,
      durationMs: 800,
    },
    {
      type: "agentMessage",
      id: "agent-history",
      text: "Pairing flow is ready for mobile supervision.",
      phase: "final_answer",
    },
  ],
  status: "completed",
  error: null,
  startedAt: now - 400,
  completedAt: now - 390,
  durationMs: 10_000,
};

const thread = {
  id: "thread-pairing",
  forkedFromId: null,
  preview: "Ship pairing flow",
  ephemeral: false,
  modelProvider: "openai",
  createdAt: now - 3_600,
  updatedAt: now - 120,
  status: { type: "idle" },
  path: null,
  cwd,
  cliVersion: "0.126.0-alpha.8",
  source: "appServer",
  agentNickname: null,
  agentRole: null,
  gitInfo: {
    sha: "abc123",
    branch: "main",
    originUrl: "https://example.com/repo.git",
  },
  name: "Ship pairing flow",
  turns: [historyTurn],
};

const responses = {
  initialize: {
    userAgent: "Fake App Server/1.0.0",
    codexHome: "/tmp/codex-home",
    platformFamily: "unix",
    platformOs: "macos",
  },
};

const stdin = readline.createInterface({ input: process.stdin });
stdin.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  const message = JSON.parse(line);
  if (!("method" in message) && "id" in message) {
    handleResponse(message);
    return;
  }

  switch (message.method) {
    case "initialize":
      send({ id: message.id, result: responses.initialize });
      break;
    case "initialized":
      break;
    case "thread/loaded/list":
      send({ id: message.id, result: { data: [], nextCursor: null } });
      break;
    case "thread/list":
      send({ id: message.id, result: { data: [snapshotThread()], nextCursor: null, backwardsCursor: null } });
      break;
    case "thread/resume":
      send({ id: message.id, result: baseResumeResponse() });
      break;
    case "thread/read":
      send({ id: message.id, result: { thread: snapshotThread() } });
      break;
    case "turn/start":
      startTurn(message.id, message.params);
      break;
    case "turn/steer":
      send({ id: message.id, result: { turnId: liveTurn?.id ?? "turn-live" } });
      break;
    case "turn/interrupt":
      interruptTurn(message.id);
      break;
    default:
      send({
        id: message.id,
        error: {
          code: -32601,
          message: `Unsupported method: ${message.method}`,
        },
      });
      break;
  }
});

function startTurn(id, params) {
  liveTurn = {
    id: `turn-${Date.now()}`,
    items: [],
    status: "inProgress",
    error: null,
    startedAt: Math.floor(Date.now() / 1000),
    completedAt: null,
    durationMs: null,
  };
  thread.status = { type: "active", activeFlags: [] };
  thread.updatedAt = Math.floor(Date.now() / 1000);

  send({ id, result: { turn: liveTurn } });
  send({ method: "thread/status/changed", params: { threadId: thread.id, status: thread.status } });
  send({ method: "turn/started", params: { threadId: thread.id, turn: liveTurn } });

  const userMessage = {
    type: "userMessage",
    id: "user-live",
    content: params.input,
  };
  send({ method: "item/started", params: { threadId: thread.id, turnId: liveTurn.id, item: userMessage } });
  send({ method: "item/completed", params: { threadId: thread.id, turnId: liveTurn.id, item: userMessage } });

  if (scenario === "approval") {
    thread.status = { type: "active", activeFlags: ["waitingOnApproval"] };
    send({ method: "thread/status/changed", params: { threadId: thread.id, status: thread.status } });
    pendingApprovalRequestID = "approval-request-1";
    send({
      id: pendingApprovalRequestID,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: thread.id,
        turnId: liveTurn.id,
        itemId: "cmd-approval-1",
        approvalId: "mobile-approval-1",
        reason: "Need approval before running the verification command.",
        command: "npm test",
        cwd,
      },
    });
    return;
  }

  completeLiveTurn("Live summary from fake App Server.");
}

function interruptTurn(id) {
  send({ id, result: {} });
  if (!liveTurn) {
    return;
  }
  liveTurn.status = "interrupted";
  liveTurn.completedAt = Math.floor(Date.now() / 1000);
  thread.status = { type: "idle" };
  thread.updatedAt = liveTurn.completedAt;
  send({ method: "thread/status/changed", params: { threadId: thread.id, status: thread.status } });
  send({ method: "turn/completed", params: { threadId: thread.id, turn: liveTurn } });
}

function handleResponse(message) {
  if (message.id !== pendingApprovalRequestID) {
    return;
  }

  send({ method: "serverRequest/resolved", params: { threadId: thread.id, requestId: message.id } });

  if (message.result?.decision === "accept" || message.result?.decision === "approved") {
    const commandItem = {
      type: "commandExecution",
      id: "cmd-approval-1",
      command: "npm test",
      cwd,
      status: "completed",
      aggregatedOutput: "6 passing",
      exitCode: 0,
      durationMs: 1200,
    };
    send({ method: "item/completed", params: { threadId: thread.id, turnId: liveTurn.id, item: commandItem } });
    completeLiveTurn("Approval accepted and verification finished cleanly.");
  } else {
    completeFailedTurn("Approval rejected by the mobile supervisor.");
  }

  pendingApprovalRequestID = null;
}

function completeLiveTurn(text) {
  const agentItem = {
    type: "agentMessage",
    id: "agent-live",
    text: "",
    phase: "final_answer",
  };
  send({ method: "item/started", params: { threadId: thread.id, turnId: liveTurn.id, item: agentItem } });
  send({
    method: "item/agentMessage/delta",
    params: { threadId: thread.id, turnId: liveTurn.id, itemId: agentItem.id, delta: text },
  });

  const completedItem = {
    ...agentItem,
    text,
  };
  send({ method: "item/completed", params: { threadId: thread.id, turnId: liveTurn.id, item: completedItem } });

  liveTurn.status = "completed";
  liveTurn.completedAt = Math.floor(Date.now() / 1000);
  thread.status = { type: "idle" };
  thread.updatedAt = liveTurn.completedAt;
  send({ method: "thread/status/changed", params: { threadId: thread.id, status: thread.status } });
  send({ method: "turn/completed", params: { threadId: thread.id, turn: liveTurn } });
}

function completeFailedTurn(message) {
  liveTurn.status = "failed";
  liveTurn.error = {
    message,
    additionalDetails: null,
  };
  liveTurn.completedAt = Math.floor(Date.now() / 1000);
  thread.status = { type: "idle" };
  thread.updatedAt = liveTurn.completedAt;
  send({ method: "thread/status/changed", params: { threadId: thread.id, status: thread.status } });
  send({ method: "turn/completed", params: { threadId: thread.id, turn: liveTurn } });
}

function baseResumeResponse() {
  return {
    thread: snapshotThread(),
    model: "gpt-5.5",
    modelProvider: "openai",
    serviceTier: null,
    cwd,
    instructionSources: [],
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: {
      type: "readOnly",
      networkAccess: false,
    },
    permissionProfile: null,
    reasoningEffort: "medium",
  };
}

function snapshotThread() {
  return {
    ...thread,
    turns: liveTurn ? [historyTurn, liveTurn] : [historyTurn],
  };
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
