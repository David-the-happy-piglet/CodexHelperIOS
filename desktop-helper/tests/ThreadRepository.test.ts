import { describe, expect, it } from "vitest";
import { ThreadRepository } from "../src/domain/ThreadRepository.js";
import { MockCodexBridge } from "../src/bridge/MockCodexBridge.js";
import { StructuredLogger } from "../src/util/logger.js";

describe("ThreadRepository", () => {
  it("indexes seeded threads and counts pending approvals", async () => {
    const repository = new ThreadRepository();
    const bridge = new MockCodexBridge(new StructuredLogger({ test: true }), { tickIntervalMs: 0 });

    await bridge.connect();
    repository.seed(await bridge.getSnapshots());

    expect(repository.listThreads().length).toBe(2);
    expect(repository.getApprovalsPending()).toBe(1);
  });

  it("updates thread state when approval changes arrive", async () => {
    const repository = new ThreadRepository();
    const bridge = new MockCodexBridge(new StructuredLogger({ test: true }), { tickIntervalMs: 0 });
    await bridge.connect();
    repository.seed(await bridge.getSnapshots());

    const thread = repository.getThread("thread-approval");
    expect(thread?.thread.status).toBe("blocked");

    repository.apply({
      type: "approval",
      approval: {
        id: "approval-signing",
        threadID: "thread-approval",
        title: "Update release signing defaults",
        rationale: "Resolved",
        riskLevel: "low",
        createdAt: new Date().toISOString(),
        status: "approved",
      },
    });

    expect(repository.getThread("thread-approval")?.thread.pendingApprovals).toBe(0);
  });
});

