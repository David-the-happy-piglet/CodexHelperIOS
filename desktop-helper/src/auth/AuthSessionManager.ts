import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AuthTokens,
  PairingCode,
  PairingExchangeRequest,
  PairingExchangeResponse,
  SessionDevice,
} from "@codex-companion/protocol";
import type { Logger } from "../util/logger.js";

interface PairingRecord {
  code: string;
  helperURL: string;
  expiresAt: string;
}

interface RefreshSessionRecord {
  id: string;
  deviceID: string;
  refreshTokenHash: string;
  createdAt: string;
  revokedAt?: string;
}

interface PersistedAuthState {
  signingKey: string;
  devices: SessionDevice[];
  refreshSessions: RefreshSessionRecord[];
}

interface AccessTokenPayload {
  deviceID: string;
  exp: number;
  iat: number;
  jti: string;
}

export class AuthSessionManager {
  private readonly pairings = new Map<string, PairingRecord>();
  private state: PersistedAuthState = {
    signingKey: randomBytes(32).toString("hex"),
    devices: [],
    refreshSessions: [],
  };

  constructor(
    private readonly stateFilePath: string,
    private readonly logger: Logger,
    private readonly accessTokenLifetimeSeconds = 60 * 30,
  ) {}

  async load(): Promise<void> {
    try {
      const contents = await readFile(this.stateFilePath, "utf8");
      this.state = JSON.parse(contents) as PersistedAuthState;
    } catch {
      await this.persist();
    }
  }

  async createPairingCode(helperURL: string): Promise<PairingCode> {
    const code = this.generatePairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const record: PairingRecord = {
      code,
      helperURL,
      expiresAt,
    };

    this.pairings.set(code, record);

    return {
      code,
      expiresAt,
      helperURL,
      qrPayload: `codexcompanion://pair?helper=${encodeURIComponent(helperURL)}&code=${code}`,
    };
  }

  async exchangePairingCode(request: PairingExchangeRequest): Promise<PairingExchangeResponse> {
    const pairing = this.pairings.get(request.pairingCode.trim().toUpperCase());
    if (!pairing || new Date(pairing.expiresAt).getTime() < Date.now()) {
      throw new Error("Pairing code is invalid or has expired.");
    }

    const now = new Date().toISOString();
    const device: SessionDevice = {
      id: randomUUID(),
      name: request.deviceName.trim(),
      pairedAt: now,
      lastSeenAt: now,
    };

    this.state.devices.push(device);
    const tokens = this.issueTokens(device.id);
    await this.persist();
    this.pairings.delete(pairing.code);
    this.logger.info("paired_device", { deviceID: device.id, deviceName: device.name });

    return { device, tokens };
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    const session = this.lookupRefreshSession(refreshToken);
    if (!session || session.revokedAt) {
      throw new Error("Refresh token is invalid.");
    }

    const device = this.findDevice(session.deviceID);
    if (!device || device.revokedAt) {
      throw new Error("Paired device no longer exists.");
    }

    const replacement = this.issueTokens(device.id, session.id);
    device.lastSeenAt = new Date().toISOString();
    await this.persist();
    return replacement;
  }

  verifyAccessToken(accessToken: string): SessionDevice | undefined {
    const [payloadPart, signature] = accessToken.split(".");
    if (!payloadPart || !signature) {
      return undefined;
    }

    const expected = createHmac("sha256", this.state.signingKey).update(payloadPart).digest("base64url");
    if (expected !== signature) {
      return undefined;
    }

    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as AccessTokenPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return undefined;
    }

    const device = this.findDevice(payload.deviceID);
    if (!device || device.revokedAt) {
      return undefined;
    }

    device.lastSeenAt = new Date().toISOString();
    void this.persist();
    return device;
  }

  async logout(refreshToken: string): Promise<void> {
    const session = this.lookupRefreshSession(refreshToken);
    if (!session) {
      return;
    }

    session.revokedAt = new Date().toISOString();
    await this.persist();
  }

  listDevices(): SessionDevice[] {
    return this.state.devices.slice().sort((lhs, rhs) => rhs.pairedAt.localeCompare(lhs.pairedAt));
  }

  async revokeDevice(deviceID: string): Promise<SessionDevice | undefined> {
    const device = this.findDevice(deviceID);
    if (!device) {
      return undefined;
    }

    device.revokedAt = new Date().toISOString();
    for (const session of this.state.refreshSessions.filter((candidate) => candidate.deviceID === deviceID)) {
      session.revokedAt = device.revokedAt;
    }

    await this.persist();
    return device;
  }

  private generatePairingCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  }

  private issueTokens(deviceID: string, existingSessionID?: string): AuthTokens {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.accessTokenLifetimeSeconds;
    const payloadPart = Buffer.from(
      JSON.stringify({ deviceID, exp, iat: now, jti: randomUUID() } satisfies AccessTokenPayload),
    ).toString("base64url");
    const signature = createHmac("sha256", this.state.signingKey).update(payloadPart).digest("base64url");
    const accessToken = `${payloadPart}.${signature}`;
    const refreshToken = randomBytes(32).toString("base64url");
    const refreshTokenHash = createHash("sha256").update(refreshToken).digest("hex");

    if (existingSessionID) {
      const existing = this.state.refreshSessions.find((candidate) => candidate.id === existingSessionID);
      if (existing) {
        existing.refreshTokenHash = refreshTokenHash;
        existing.revokedAt = undefined;
      }
    } else {
      this.state.refreshSessions.push({
        id: randomUUID(),
        deviceID,
        refreshTokenHash,
        createdAt: new Date().toISOString(),
      });
    }

    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  private lookupRefreshSession(refreshToken: string): RefreshSessionRecord | undefined {
    const hash = createHash("sha256").update(refreshToken).digest("hex");
    return this.state.refreshSessions.find((candidate) => candidate.refreshTokenHash === hash);
  }

  private findDevice(deviceID: string): SessionDevice | undefined {
    return this.state.devices.find((device) => device.id === deviceID);
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.stateFilePath), { recursive: true });
    await writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2), "utf8");
  }
}
