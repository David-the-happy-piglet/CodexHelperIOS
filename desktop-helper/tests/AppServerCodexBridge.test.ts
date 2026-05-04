import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AppServerCodexBridge } from "../src/bridge/AppServerCodexBridge.js";
import { StructuredLogger } from "../src/util/logger.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake-app-server.mjs",
);

describe("AppServerCodexBridge", () => {
  it("hydrates recent thread snapshots from the App Server session history", async () => {
    const bridge = createBridge("basic");

    try {
      await bridge.connect();
      const snapshots = await bridge.getSnapshots();

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.thread.title).toBe("Ship pairing flow");
      expect(snapshots[0]?.preview.changedFilesCount).toBe(2);
      expect(snapshots[0]?.preview.testsPassed).toBe(4);
      expect(snapshots[0]?.latestSummary).toContain("Pairing flow is ready");
    } finally {
      await bridge.disconnect();
    }
  });

  it("turns lightweight mobile commands into App Server turns and summary updates", async () => {
    const bridge = createBridge("basic");
    const updateTypes: string[] = [];
    bridge.subscribe((update) => updateTypes.push(update.type));

    try {
      await bridge.connect();
      await bridge.sendCommand("thread-pairing", { type: "summarize" });

      const snapshot = await waitFor(async () => {
        const [current] = await bridge.getSnapshots();
        return current;
      }, (current) => current.latestSummary.includes("Live summary from fake App Server."));

      expect(snapshot.thread.status).toBe("done");
      expect(updateTypes).toContain("summary");
      expect(snapshot.events.some((event) => event.type === "task.completed")).toBe(true);
    } finally {
      await bridge.disconnect();
    }
  });

  it("maps App Server approval requests into companion approvals and resolves them back", async () => {
    const bridge = createBridge("approval");

    try {
      await bridge.connect();
      await bridge.sendCommand("thread-pairing", { type: "continue" });

      const pendingApproval = await waitFor(async () => {
        const [snapshot] = await bridge.getSnapshots();
        return snapshot?.approvals.find((approval) => approval.status === "pending");
      }, Boolean);

      expect(pendingApproval.title).toContain("Approve command");

      const resolved = await bridge.resolveApproval("thread-pairing", {
        approvalID: pendingApproval.id,
        action: "approve",
      });
      expect(resolved.status).toBe("approved");

      const snapshot = await waitFor(async () => {
        const [current] = await bridge.getSnapshots();
        return current;
      }, (current) => current.latestSummary.includes("Approval accepted"));

      expect(snapshot.thread.pendingApprovals).toBe(0);
      expect(snapshot.approvals.some((approval) => approval.id === pendingApproval.id && approval.status === "approved")).toBe(true);
    } finally {
      await bridge.disconnect();
    }
  });
});

function createBridge(scenario: string) {
  return new AppServerCodexBridge({
    command: process.execPath,
    args: [fixturePath, scenario],
    cwd: process.cwd(),
    logger: new StructuredLogger({ test: true, scenario }),
    threadLimit: 4,
  });
}

async function waitFor<T>(
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 5_000,
  intervalMs = 25,
): Promise<T> {
  const start = Date.now();
  let lastValue = await producer();

  while (!predicate(lastValue)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for condition. Last value: ${JSON.stringify(lastValue)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    lastValue = await producer();
  }

  return lastValue;
}
