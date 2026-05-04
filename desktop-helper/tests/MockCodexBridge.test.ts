import { describe, expect, it } from "vitest";
import { MockCodexBridge } from "../src/bridge/MockCodexBridge.js";
import { StructuredLogger } from "../src/util/logger.js";

describe("MockCodexBridge", () => {
  it("emits updates when commands arrive", async () => {
    const bridge = new MockCodexBridge(new StructuredLogger({ test: true }), { tickIntervalMs: 0 });
    const updates: string[] = [];
    bridge.subscribe((update) => updates.push(update.type));

    await bridge.connect();
    await bridge.sendCommand("thread-pairing", { type: "pause" });

    expect(updates).toContain("thread");
    expect(updates).toContain("event");
  });

  it("resolves approvals and returns the updated object", async () => {
    const bridge = new MockCodexBridge(new StructuredLogger({ test: true }), { tickIntervalMs: 0 });
    await bridge.connect();

    const approval = await bridge.resolveApproval("thread-approval", {
      approvalID: "approval-signing",
      action: "approve",
    });

    expect(approval.status).toBe("approved");
  });

  it("appends conversation history when mobile input arrives", async () => {
    const bridge = new MockCodexBridge(new StructuredLogger({ test: true }), { tickIntervalMs: 0 });
    await bridge.connect();

    await bridge.sendInput("thread-pairing", { prompt: "Give me a fresh update from mobile." });
    const snapshots = await bridge.getSnapshots();
    const pairing = snapshots.find((snapshot) => snapshot.thread.id === "thread-pairing");

    expect(pairing?.conversation.some((message) => message.kind === "user" && message.body.includes("fresh update"))).toBe(true);
    expect(pairing?.conversation.some((message) => message.kind === "assistant")).toBe(true);
  });

  it("creates a new thread for a requested project path", async () => {
    const bridge = new MockCodexBridge(new StructuredLogger({ test: true }), { tickIntervalMs: 0 });
    await bridge.connect();

    const created = await bridge.createThread({
      projectPath: "/tmp/Codex Mobile Project",
      title: "Start from iPhone",
      initialPrompt: "Create the first mobile thread.",
    });

    expect(created.projectPath).toBe("/tmp/Codex Mobile Project");
    expect(created.projectName).toBe("Codex Mobile Project");
    expect(created.title).toBe("Start from iPhone");
  });
});
