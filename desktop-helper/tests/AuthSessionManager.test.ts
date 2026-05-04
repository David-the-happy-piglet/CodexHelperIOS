import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthSessionManager } from "../src/auth/AuthSessionManager.js";
import { StructuredLogger } from "../src/util/logger.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("AuthSessionManager", () => {
  it("creates a pairing code and exchanges it for tokens", async () => {
    const manager = await createManager();
    const pairing = await manager.createPairingCode("https://localhost:9443");
    const session = await manager.exchangePairingCode({ deviceName: "Wenjie's iPhone", pairingCode: pairing.code });

    expect(session.device.name).toBe("Wenjie's iPhone");
    expect(session.tokens.accessToken).toContain(".");
    expect(manager.verifyAccessToken(session.tokens.accessToken)?.id).toBe(session.device.id);
  });

  it("refreshes access tokens", async () => {
    const manager = await createManager();
    const pairing = await manager.createPairingCode("https://localhost:9443");
    const session = await manager.exchangePairingCode({ deviceName: "Demo Phone", pairingCode: pairing.code });
    const refreshed = await manager.refreshTokens(session.tokens.refreshToken);

    expect(refreshed.accessToken).not.toBe(session.tokens.accessToken);
    expect(manager.verifyAccessToken(refreshed.accessToken)?.name).toBe("Demo Phone");
  });

  it("revokes a device and invalidates subsequent verification", async () => {
    const manager = await createManager();
    const pairing = await manager.createPairingCode("https://localhost:9443");
    const session = await manager.exchangePairingCode({ deviceName: "Review iPhone", pairingCode: pairing.code });

    await manager.revokeDevice(session.device.id);

    expect(manager.verifyAccessToken(session.tokens.accessToken)).toBeUndefined();
    expect(manager.listDevices().find((device) => device.id === session.device.id)?.revokedAt).toBeTruthy();
  });
});

async function createManager(): Promise<AuthSessionManager> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-auth-"));
  tempDirs.push(directory);
  const manager = new AuthSessionManager(path.join(directory, "auth.json"), new StructuredLogger({ test: true }));
  await manager.load();
  return manager;
}

