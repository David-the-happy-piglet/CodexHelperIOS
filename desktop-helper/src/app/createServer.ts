import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import express, { type Request, type Response, type NextFunction } from "express";
import WebSocket, { WebSocketServer } from "ws";
import type {
  ApprovalResolutionRequest,
  ConnectionHealth,
  CreateProjectRequest,
  CreateThreadRequest,
  PairingExchangeRequest,
  RefreshRequest,
  ThreadCommandRequest,
  ThreadInputRequest,
} from "@codex-companion/protocol";
import { AuthSessionManager } from "../auth/AuthSessionManager.js";
import type { CodexBridge } from "../bridge/CodexBridge.js";
import { EventBroadcaster } from "../domain/EventBroadcaster.js";
import { ThreadRepository } from "../domain/ThreadRepository.js";
import type { Logger } from "../util/logger.js";

export interface HelperConfig {
  host: string;
  port: number;
  publicBaseURL: string;
  tlsKeyPath: string;
  tlsCertPath: string;
  demoMode: boolean;
}

export interface HelperDependencies {
  bridge: CodexBridge;
  auth: AuthSessionManager;
  repository: ThreadRepository;
  broadcaster: EventBroadcaster;
  logger: Logger;
  config: HelperConfig;
}

export interface RunningHelperServer {
  app: express.Express;
  server: https.Server;
  stop(): Promise<void>;
}

interface AuthedRequest extends Request {
  deviceID?: string;
}

export function createExpressApp(deps: HelperDependencies): express.Express {
  const app = express();
  app.use(express.json());
  app.use(requestLogging(deps.logger));

  app.get("/health", (_request, response) => {
    response.json(healthSnapshot(deps));
  });

  app.post("/pairing/code", asyncHandler(async (_request, response) => {
    const pairingCode = await deps.auth.createPairingCode(deps.config.publicBaseURL);
    response.json(pairingCode);
  }));

  app.post("/pairing/exchange", asyncHandler(async (request, response) => {
    const session = await deps.auth.exchangePairingCode(request.body as PairingExchangeRequest);
    response.json(session);
  }));

  app.post("/auth/refresh", asyncHandler(async (request, response) => {
    const body = request.body as RefreshRequest;
    response.json(await deps.auth.refreshTokens(body.refreshToken));
  }));

  app.post("/auth/logout", asyncHandler(async (request, response) => {
    const body = request.body as RefreshRequest;
    await deps.auth.logout(body.refreshToken);
    response.status(204).send();
  }));

  app.use(requireAuth(deps.auth));

  app.get("/devices", (_request, response) => {
    response.json({ devices: deps.auth.listDevices() });
  });

  app.post("/devices/:id/revoke", asyncHandler(async (request, response) => {
    const device = await deps.auth.revokeDevice(String(request.params.id));
    if (!device) {
      response.status(404).json({ error: "Device not found." });
      return;
    }

    response.json(device);
  }));

  app.get("/threads", (_request, response) => {
    response.json({
      threads: deps.repository.listThreads(),
      approvalsPending: deps.repository.getApprovalsPending(),
      runningTasks: deps.repository.getRunningTasks(),
      health: healthSnapshot(deps),
    });
  });

  app.post("/projects", asyncHandler(async (request, response) => {
    const body = request.body as CreateProjectRequest;
    const name = body.name?.trim();
    if (!name) {
      throw new Error("Project name is required.");
    }

    const projectPath = path.resolve(body.projectPath?.trim() || path.join(defaultProjectsRoot(), sanitizeProjectFolderName(name)));
    await fs.promises.mkdir(projectPath, { recursive: true });

    const thread = await deps.bridge.createThread({
      projectPath,
      title: body.initialThreadTitle?.trim() || `Kick off ${name}`,
      initialPrompt: body.initialPrompt?.trim() || undefined,
    });
    response.status(201).json(thread);
  }));

  app.post("/threads", asyncHandler(async (request, response) => {
    const body = request.body as CreateThreadRequest;
    const thread = await deps.bridge.createThread({
      projectPath: body.projectPath,
      title: body.title,
      initialPrompt: body.initialPrompt?.trim() || undefined,
    });
    response.status(201).json(thread);
  }));

  app.get("/threads/:id", (request, response) => {
    const thread = deps.repository.getThread(String(request.params.id));
    if (!thread) {
      response.status(404).json({ error: "Thread not found." });
      return;
    }

    response.json(thread);
  });

  app.get("/threads/:id/preview", (request, response) => {
    const preview = deps.repository.getPreview(String(request.params.id));
    if (!preview) {
      response.status(404).json({ error: "Preview not found." });
      return;
    }

    response.json(preview);
  });

  app.post("/threads/:id/command", asyncHandler(async (request, response) => {
    await deps.bridge.sendCommand(String(request.params.id), request.body as ThreadCommandRequest);
    response.status(202).json({ accepted: true });
  }));

  app.post("/threads/:id/input", asyncHandler(async (request, response) => {
    await deps.bridge.sendInput(String(request.params.id), request.body as ThreadInputRequest);
    response.status(202).json({ accepted: true });
  }));

  app.post("/threads/:id/approval", asyncHandler(async (request, response) => {
    const approval = await deps.bridge.resolveApproval(String(request.params.id), request.body as ApprovalResolutionRequest);
    response.json(approval);
  }));

  app.use(errorHandler(deps.logger));

  return app;
}

export async function createRunningHelperServer(deps: HelperDependencies): Promise<RunningHelperServer> {
  const app = createExpressApp(deps);
  const server = https.createServer(
    {
      key: fs.readFileSync(path.resolve(deps.config.tlsKeyPath)),
      cert: fs.readFileSync(path.resolve(deps.config.tlsCertPath)),
    },
    app,
  );

  const sockets = new WebSocketServer({ noServer: true });

  deps.broadcaster.setCountChangedHandler(() => {
    deps.broadcaster.broadcast("connection.health_changed", healthSnapshot(deps));
  });

  server.on("upgrade", (request, socket, head) => {
    if (!request.url?.startsWith("/events")) {
      socket.destroy();
      return;
    }

    const token = bearerToken(request.headers.authorization);
    if (!token || !deps.auth.verifyAccessToken(token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    sockets.handleUpgrade(request, socket, head, (websocket) => {
      deps.broadcaster.attach(websocket);
      websocket.send(JSON.stringify({ event: "connection.health_changed", data: healthSnapshot(deps) }));
      for (const thread of deps.repository.listThreads()) {
        websocket.send(JSON.stringify({ event: "thread.updated", data: thread }));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(deps.config.port, deps.config.host, resolve);
  });

  deps.logger.info("helper_server_started", {
    host: deps.config.host,
    port: deps.config.port,
    publicBaseURL: deps.config.publicBaseURL,
  });

  return {
    app,
    server,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

export function wireBridgeToRepository(deps: HelperDependencies): () => void {
  return deps.bridge.subscribe((update) => {
    const mutation = deps.repository.apply(update);

    switch (update.type) {
      case "snapshot":
      case "thread": {
        const threadID = update.type === "snapshot" ? update.snapshot.thread.id : update.thread.id;
        const thread = deps.repository.getThread(threadID)?.thread;
        if (!thread) {
          return;
        }

        deps.broadcaster.broadcast(mutation.created ? "thread.created" : "thread.updated", thread);
        break;
      }
      case "preview":
        deps.broadcaster.broadcast("artifact.generated", update.preview);
        break;
      case "event":
        deps.broadcaster.broadcast(update.event.type, update.event);
        break;
      case "approval":
        deps.broadcaster.broadcast(
          update.approval.status === "pending" ? "approval.requested" : "approval.resolved",
          update.approval,
        );
        break;
      case "conversation":
        break;
      case "summary":
        deps.broadcaster.broadcast("task.summary_updated", update);
        break;
      case "plan":
        deps.broadcaster.broadcast("task.phase_changed", update);
        break;
      case "rawLog":
        deps.broadcaster.broadcast("thread.updated", { threadID: update.threadID, latestRawLog: update.latestRawLog });
        break;
      case "health":
        deps.broadcaster.broadcast("connection.health_changed", healthSnapshot(deps));
        break;
    }
  });
}

function requestLogging(logger: Logger) {
  return (request: Request, _response: Response, next: NextFunction) => {
    logger.info("http_request", { method: request.method, path: request.path });
    next();
  };
}

function requireAuth(auth: AuthSessionManager) {
  return (request: AuthedRequest, response: Response, next: NextFunction) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      response.status(401).json({ error: "Missing bearer token." });
      return;
    }

    const device = auth.verifyAccessToken(token);
    if (!device) {
      response.status(401).json({ error: "Invalid bearer token." });
      return;
    }

    request.deviceID = device.id;
    next();
  };
}

function errorHandler(logger: Logger) {
  return (error: Error, _request: Request, response: Response, _next: NextFunction) => {
    logger.error("request_failed", { error: error.message });
    response.status(400).json({ error: error.message });
  };
}

function asyncHandler(handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

function bearerToken(headerValue: string | string[] | undefined): string | undefined {
  if (typeof headerValue !== "string" || !headerValue.startsWith("Bearer ")) {
    return undefined;
  }

  return headerValue.slice("Bearer ".length);
}

function defaultProjectsRoot(): string {
  return process.env.CODEX_PROJECTS_ROOT?.trim() || path.dirname(process.cwd());
}

function sanitizeProjectFolderName(name: string): string {
  return name
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .replace(/^\.+$/, "")
    .trim() || "codex-project";
}

export function healthSnapshot(deps: HelperDependencies): ConnectionHealth {
  return {
    codexBridge: deps.repository.getBridgeHealth(),
    websocketClients: deps.broadcaster.count(),
    demoMode: deps.config.demoMode,
    lastBridgeSyncAt: deps.repository.getLastBridgeSyncAt(),
  };
}
