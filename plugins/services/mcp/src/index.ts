// MCP v1.27.1 — stateless mode, per-request server+transport
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import type {} from "@zhin.js/http";
import { usePlugin } from "zhin.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export interface McpConfig {
  enabled?: boolean;
  path?: string;
}

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "zhin-mcp-server", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  registerTools(server);
  registerResources(server);
  registerPrompts(server);
  return server;
}

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const { root, useContext, logger, onDispose } = usePlugin();

useContext("server", (server: Server) => {
  const configService = root.inject("config")!;
  const appConfig = configService.get<{ mcp?: McpConfig }>("zhin.config.yml");
  const { enabled = true, path: mcpPath = "/mcp" } = appConfig.mcp || {};

  if (!enabled) {
    logger.info("MCP Server is disabled");
    return;
  }

  const mcpHandler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === "POST") {
        const body = await parseJsonBody(req);
        const mcpServer = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        res.writeHead(405, { Allow: "POST", "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed in stateless mode" },
            id: null,
          }),
        );
        return;
      }

      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    } catch (err) {
      logger.error("MCP request error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      }
    }
  };

  const originalListeners = server.listeners("request").slice();
  server.removeAllListeners("request");

  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "";
    if (url === mcpPath || url.startsWith(mcpPath + "?") || url.startsWith(mcpPath + "/")) {
      mcpHandler(req, res);
      return;
    }
    for (const listener of originalListeners) {
      (listener as Function).call(server, req, res);
    }
  });

  logger.info(`MCP Server ready at ${mcpPath} (stateless mode)`);

  onDispose(() => {
    server.removeAllListeners("request");
    for (const listener of originalListeners) {
      server.on("request", listener as (...args: any[]) => void);
    }
  });
});
