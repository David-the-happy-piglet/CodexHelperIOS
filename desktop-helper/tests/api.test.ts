import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExpressApp } from "../src/app/createServer.js";
import { AuthSessionManager } from "../src/auth/AuthSessionManager.js";
import { MockCodexBridge } from "../src/bridge/MockCodexBridge.js";
import { EventBroadcaster } from "../src/domain/EventBroadcaster.js";
import { ThreadRepository } from "../src/domain/ThreadRepository.js";
import { StructuredLogger } from "../src/util/logger.js";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-helper-api-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("helper api", () => {
  it("requires auth for thread listing", async () => {
    const app = await createTestApp();
    const response = await request(app).get("/threads");
    expect(response.status).toBe(401);
  });

  it("lists threads after pairing and exchange", async () => {
    const app = await createTestApp();
    const pairing = await request(app).post("/pairing/code").send({});
    const exchange = await request(app).post("/pairing/exchange").send({
      deviceName: "API Test Phone",
      pairingCode: pairing.body.code,
    });

    const response = await request(app)
      .get("/threads")
      .set("Authorization", `Bearer ${exchange.body.tokens.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.threads).toHaveLength(2);
    expect(response.body.runningTasks).toBeGreaterThanOrEqual(1);
  });

  it("accepts mobile thread input after pairing", async () => {
    const app = await createTestApp();
    const pairing = await request(app).post("/pairing/code").send({});
    const exchange = await request(app).post("/pairing/exchange").send({
      deviceName: "API Test Phone",
      pairingCode: pairing.body.code,
    });

    const response = await request(app)
      .post("/threads/thread-pairing/input")
      .set("Authorization", `Bearer ${exchange.body.tokens.accessToken}`)
      .send({ prompt: "Summarize the latest status from mobile." });

    expect(response.status).toBe(202);
    expect(response.body.accepted).toBe(true);
  });

  it("creates a project and first thread after pairing", async () => {
    const app = await createTestApp();
    const pairing = await request(app).post("/pairing/code").send({});
    const exchange = await request(app).post("/pairing/exchange").send({
      deviceName: "API Test Phone",
      pairingCode: pairing.body.code,
    });

    const response = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${exchange.body.tokens.accessToken}`)
      .send({
        name: "Mobile Created Project",
        initialThreadTitle: "Kickoff thread",
        initialPrompt: "Summarize the new project scope.",
      });

    expect(response.status).toBe(201);
    expect(response.body.projectName).toBe("Mobile Created Project");
    expect(response.body.title).toBe("Kickoff thread");
  });
});

async function createTestApp() {
  const logger = new StructuredLogger({ test: true });
  const auth = new AuthSessionManager(path.join(tempDir, "auth.json"), logger);
  await auth.load();

  const bridge = new MockCodexBridge(logger, { tickIntervalMs: 0 });
  await bridge.connect();
  const repository = new ThreadRepository();
  repository.seed(await bridge.getSnapshots());

  return createExpressApp({
    auth,
    bridge,
    repository,
    broadcaster: new EventBroadcaster(),
    logger,
    config: {
      host: "127.0.0.1",
      port: 9443,
      publicBaseURL: "https://localhost:9443",
      tlsKeyPath: "",
      tlsCertPath: "",
      demoMode: true,
    },
  });
}
