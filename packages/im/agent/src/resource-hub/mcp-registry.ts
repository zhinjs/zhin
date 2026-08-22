/**
 * McpRegistry — MCP client service management with common/specialized support.
 *
 * Manages connections to external MCP Servers and bridges their
 * tools/resources/prompts into the agent's resource pool.
 */

import { getLogger } from '@zhin.js/core';
import type { AgentTool } from '@zhin.js/ai';
import { parseMcpQualifiedToolName } from '@zhin.js/ai/mcp-qualified-name';
import { McpClientManager } from '../mcp-client/index.js';
import { ResourceRegistry } from './resource-registry.js';
import type { McpServerEntry, McpResource, McpPrompt, ResourceScope } from './types.js';

const logger = getLogger('McpRegistry');

export interface McpConnection {
  name: string;
  connected: boolean;
  tools: AgentTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
}

export interface McpEnsureConnectionEvent {
  phase: 'start' | 'finish' | 'error';
  serverName: string;
  connected?: boolean;
  toolNames?: string[];
  error?: string;
}

export interface McpQualifiedToolInfo {
  connection: string;
  qualifiedName: string;
  tool: string;
  description: string;
}

export class McpRegistry extends ResourceRegistry<McpServerEntry> {
  private readonly manager = new McpClientManager();
  private readonly connections = new Map<string, McpConnection>();

  async connect(name: string): Promise<McpConnection> {
    const entry = this.get(name);
    if (!entry) throw new Error(`MCP server "${name}" not registered`);

    const existing = this.connections.get(name);
    if (existing?.connected) {
      const healthy = await this.manager.isHealthy(name);
      if (healthy) return existing;
      this.disconnect(name);
    }

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
  async ensureConnected(onEvent?: (event: McpEnsureConnectionEvent) => void | Promise<void>): Promise<void> {
    for (const entry of this.getAll()) {
      if (this.isConnected(entry.name)) {
        const healthy = await this.manager.isHealthy(entry.name);
        if (healthy) continue;
        this.disconnect(entry.name);
      }
      try {
        await onEvent?.({ phase: 'start', serverName: entry.name });
        await this.connect(entry.name);
        if (!this.isConnected(entry.name)) {
          logger.warn(`MCP server "${entry.name}" is registered but not connected (check SDK or server config)`);
          await onEvent?.({
            phase: 'finish',
            serverName: entry.name,
            connected: false,
            toolNames: [],
          });
          continue;
        }
        await onEvent?.({
          phase: 'finish',
          serverName: entry.name,
          connected: true,
          toolNames: this.getToolsFromServer(entry.name).map(tool => tool.name),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`MCP server "${entry.name}" connect failed: ${message}`);
        await onEvent?.({ phase: 'error', serverName: entry.name, error: message });
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

  /** Eve-style qualified catalog for discovery / introspection (ADR 0039 P1). */
  listQualifiedTools(): McpQualifiedToolInfo[] {
    const out: McpQualifiedToolInfo[] = [];
    for (const conn of this.connections.values()) {
      if (!conn.connected) continue;
      for (const tool of conn.tools) {
        const parsed = parseMcpQualifiedToolName(tool.name);
        out.push({
          connection: conn.name,
          qualifiedName: tool.name,
          tool: parsed?.tool ?? tool.name,
          description: tool.description,
        });
      }
    }
    return out;
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
