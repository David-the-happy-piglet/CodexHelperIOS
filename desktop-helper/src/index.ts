import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthSessionManager } from "./auth/AuthSessionManager.js";
import { AppServerCodexBridge } from "./bridge/AppServerCodexBridge.js";
import { FileSystemCodexBridge } from "./bridge/FileSystemCodexBridge.js";
import { MockCodexBridge } from "./bridge/MockCodexBridge.js";
import { EventBroadcaster } from "./domain/EventBroadcaster.js";
import { ThreadRepository } from "./domain/ThreadRepository.js";
import { createRunningHelperServer, wireBridgeToRepository, type HelperConfig } from "./app/createServer.js";
import { StructuredLogger } from "./util/logger.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logger = new StructuredLogger({ service: "desktop-helper" });

async function main(): Promise<void> {
  const config = loadConfig();
  const helperMode = resolveHelperMode();
  const auth = new AuthSessionManager(path.resolve(rootDir, process.env.AUTH_STATE_PATH ?? "data/auth-state.json"), logger.child({ component: "auth" }));
  await auth.load();

  const repository = new ThreadRepository();
  const broadcaster = new EventBroadcaster();
  const bridge = createBridge(helperMode);

  await bridge.connect();
  repository.seed(await bridge.getSnapshots());
  repository.apply({ type: "health", health: await bridge.getHealth() });

  const deps = {
    bridge,
    auth,
    repository,
    broadcaster,
    logger,
    config,
  };

  const unsubscribe = wireBridgeToRepository(deps);
  const server = await createRunningHelperServer(deps);

  const shutdown = async () => {
    unsubscribe();
    await bridge.disconnect();
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

function loadConfig(): HelperConfig {
  const port = Number(process.env.PORT ?? 9443);
  const host = process.env.HOST ?? "0.0.0.0";
  const publicBaseURL = process.env.HELPER_BASE_URL ?? `https://localhost:${port}`;
  const helperMode = resolveHelperMode();

  return {
    host,
    port,
    publicBaseURL,
    tlsKeyPath: process.env.TLS_KEY_PATH ?? path.resolve(rootDir, "certs/dev-key.pem"),
    tlsCertPath: process.env.TLS_CERT_PATH ?? path.resolve(rootDir, "certs/dev-cert.pem"),
    demoMode: helperMode === "mock",
  };
}

function resolveHelperMode(): "mock" | "filesystem" | "app-server" {
  const mode = process.env.CODEX_HELPER_MODE?.trim();
  if (mode === "filesystem" || mode === "app-server") {
    return mode;
  }
  return "mock";
}

function createBridge(mode: ReturnType<typeof resolveHelperMode>) {
  switch (mode) {
    case "filesystem":
      return new FileSystemCodexBridge(
        path.resolve(rootDir, process.env.CODEX_BRIDGE_PATH ?? "local-bridge"),
        logger.child({ component: "bridge", mode: "filesystem" }),
      );
    case "app-server":
      return new AppServerCodexBridge({
        command: process.env.CODEX_APP_SERVER_COMMAND ?? "codex",
        args: process.env.CODEX_APP_SERVER_ARGS?.trim()
          ? process.env.CODEX_APP_SERVER_ARGS.trim().split(/\s+/)
          : ["app-server", "--listen", "stdio://"],
        cwd: process.env.CODEX_APP_SERVER_CWD ?? process.cwd(),
        logger,
        threadLimit: Number(process.env.CODEX_APP_SERVER_THREAD_LIMIT ?? 24),
      });
    case "mock":
    default:
      return new MockCodexBridge(logger.child({ component: "bridge", mode: "mock" }));
  }
}

void main().catch((error: Error) => {
  logger.error("desktop_helper_failed", { error: error.message });
  process.exit(1);
});
