/**
 * McpRegistry — MCP client service management with common/specialized support.
 *
 * Manages connections to external MCP Servers and bridges their
 * tools/resources/prompts into the agent's resource pool.
 */

import type { AgentTool } from '@zhin.js/ai';
import { ResourceRegistry } from './resource-registry.js';
import type { McpServerEntry, McpResource, McpPrompt } from './types.js';

export interface McpConnection {
  name: string;
  connected: boolean;
  tools: AgentTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
}

export class McpRegistry extends ResourceRegistry<McpServerEntry> {
  private readonly connections = new Map<string, McpConnection>();

  async connect(name: string): Promise<McpConnection> {
    const entry = this.get(name);
    if (!entry) throw new Error(`MCP server "${name}" not registered`);

    const existing = this.connections.get(name);
    if (existing?.connected) return existing;

    const connection: McpConnection = {
      name,
      connected: false,
      tools: [],
      resources: [],
      prompts: [],
    };

    try {
      // MCP client connection will be implemented in mcp-client/ module
      // For now, mark as connected with empty capabilities
      connection.connected = true;
      this.connections.set(name, connection);
    } catch (err: any) {
      throw err;
    }

    return connection;
  }

  disconnect(name: string): void {
    const connection = this.connections.get(name);
    if (!connection) return;
    connection.connected = false;
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

  override dispose(): void {
    for (const name of this.connections.keys()) {
      this.disconnect(name);
    }
    super.dispose();
  }
}
