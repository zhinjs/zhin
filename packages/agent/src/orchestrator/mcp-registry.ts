/**
 * McpRegistry — MCP client service management with common/specialized support.
 *
 * Manages connections to external MCP Servers and bridges their
 * tools/resources/prompts into the agent's resource pool.
 */

import { Logger } from '@zhin.js/core';
import type { AgentTool } from '@zhin.js/ai';
import { McpClientManager } from '../mcp-client/index.js';
import { ResourceRegistry } from './resource-registry.js';
import type { McpServerEntry, McpResource, McpPrompt, ResourceScope } from './types.js';

const logger = new Logger(null, 'McpRegistry');

export interface McpConnection {
  name: string;
  connected: boolean;
  tools: AgentTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
}

export class McpRegistry extends ResourceRegistry<McpServerEntry> {
  private readonly manager = new McpClientManager();
  private readonly connections = new Map<string, McpConnection>();

  async connect(name: string): Promise<McpConnection> {
    const entry = this.get(name);
    if (!entry) throw new Error(`MCP server "${name}" not registered`);

    const existing = this.connections.get(name);
    if (existing?.connected) return existing;

    const clientConn = await this.manager.connect(entry);
    const connection: McpConnection = {
      name,
      connected: clientConn.isConnected,
      tools: clientConn.tools,
      resources: clientConn.resources,
      prompts: clientConn.prompts,
    };
    this.connections.set(name, connection);
    return connection;
  }

  /** Lazy-connect all registered servers; per-server failures are logged, not thrown. */
  async ensureConnected(): Promise<void> {
    for (const entry of this.getAll()) {
      if (this.isConnected(entry.name)) continue;
      try {
        await this.connect(entry.name);
        if (!this.isConnected(entry.name)) {
          logger.warn(`MCP server "${entry.name}" is registered but not connected (check SDK or server config)`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`MCP server "${entry.name}" connect failed: ${message}`);
      }
    }
  }

  disconnect(name: string): void {
    void this.manager.disconnect(name);
    this.connections.delete(name);
  }

  getConnection(name: string): McpConnection | undefined {
    return this.connections.get(name);
  }

  getToolsFromServer(name: string): AgentTool[] {
    return this.connections.get(name)?.tools ?? [];
  }

  getResourcesFromServer(name: string): McpResource[] {
    return this.connections.get(name)?.resources ?? [];
  }

  getPromptsFromServer(name: string): McpPrompt[] {
    return this.connections.get(name)?.prompts ?? [];
  }

  getAllMcpTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.connected) tools.push(...conn.tools);
    }
    return tools;
  }

  isConnected(name: string): boolean {
    return this.connections.get(name)?.connected ?? false;
  }

  override remove(name: string, scope?: ResourceScope): boolean {
    const ok = super.remove(name, scope);
    if (ok) this.disconnect(name);
    return ok;
  }

  override dispose(): void {
    void this.manager.disconnectAll();
    this.connections.clear();
    super.dispose();
  }
}
