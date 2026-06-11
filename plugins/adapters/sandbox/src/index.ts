import path from "node:path";
import { usePlugin, type Plugin } from "zhin.js";
import type { WebSocket } from "ws";
import {
  SandboxWsHostAdapter,
  resolveSandboxEndpoint,
  type SandboxWsSocket,
} from "./sandbox-ws.js";
import { PageManager } from "@zhin.js/host-api";

type SandboxRouter = {
  ws: (path: string) => NonNullable<SandboxAdapter["wss"]>;
};

declare module "zhin.js" {
  interface Adapters {
    sandbox: SandboxAdapter;
  }
}

const plugin = usePlugin();
const logger = plugin.logger;

/** Node：`Router.ws` */
export class SandboxAdapter extends SandboxWsHostAdapter {
  wss?: { on: (ev: string, fn: (...args: unknown[]) => void) => void; close: () => void };

  constructor(plugin: ReturnType<typeof usePlugin>) {
    const appConfig = (plugin.inject("config")?.getPrimary() ?? {}) as Record<string, unknown>;
    super(plugin, resolveSandboxEndpoint(appConfig));
  }

  override async start(): Promise<void> {
    await super.start();
    this.registerConfiguredPlaceholder();
    logger.debug(
      `Sandbox placeholder: ${this.defaults.name} (offline until /sandbox WS)`,
    );
  }

  async setupWebSocket(router: SandboxRouter): Promise<void> {
    if (this.wss) return;
    this.wss = router.ws("/sandbox");

    this.wss.on("connection", (...args: unknown[]) => {
      const ws = args[0] as WebSocket;
      const req = args[1] as { socket?: { remoteAddress?: string } };
      logger.debug(
        `New sandbox connection from ${req.socket?.remoteAddress ?? "unknown"}`,
      );
      const endpoint = this.acceptWebSocket(ws as SandboxWsSocket);
      ws.on("close", () => {
        logger.debug(`Sandbox connection closed: ${endpoint.$config.name}`);
        this.endpoints.delete(endpoint.$id);
      });
      ws.on("error", (error) => {
        logger.error(`Sandbox WebSocket error for ${endpoint.$config.name}:`, error);
      });
    });

    logger.debug("Sandbox WebSocket server started at /sandbox (Node Router.ws)");
  }
}

const { provide } = usePlugin();

provide({
  name: "sandbox",
  description: "Sandbox Adapter — Node Router.ws",
  mounted: async (p: Plugin) => {
    const adapter = new SandboxAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: SandboxAdapter) => {
    for (const endpoint of adapter.endpoints.values()) {
      await endpoint.$disconnect();
    }
    adapter.wss?.close();
    await adapter.stop();
  },
} as never);

plugin.useContext("router",'sandbox', async (router: SandboxRouter,adapter: SandboxAdapter) => {
  await adapter.setupWebSocket(router);
});

plugin.useContext("web", (pageManager) => {
  pageManager.addEntry({
    id: "sandbox",
    development: path.resolve(import.meta.dirname, "../client/index.tsx"),
    production: path.resolve(import.meta.dirname, "../dist/index.js"),
    meta: { name: "Sandbox" },
  });
});

export {
  SandboxWsEndpoint,
  SandboxWsHostAdapter,
  resolveSandboxEndpoint,
  bindSandboxWsSocket,
  parseSandboxWsPayload,
  type ResolvedSandboxBot,
  type SandboxWsConfig,
  type SandboxWsSocket,
} from "./sandbox-ws.js";
