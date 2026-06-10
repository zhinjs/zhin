/**
 * McpClientManager — manages all MCP client connections.
 *
 * Used by McpRegistry for connect/disconnect; tools are merged in ZhinAgent via getAllMcpTools.
 */

import type { AgentTool } from '@zhin.js/ai';
import type { McpServerEntry, McpResource, McpPrompt } from '../orchestrator/types.js';
import { McpClientConnection } from './connection.js';

export class McpClientManager {
  private readonly connections = new Map<string, McpClientConnection>();

  async connect(entry: McpServerEntry): Promise<McpClientConnection> {
    let conn = this.connections.get(entry.name);
    if (conn?.isConnected) {
      const healthy = await this.isHealthy(entry.name);
      if (healthy) return conn;
      await this.disconnect(entry.name);
    }

    conn = new McpClientConnection(entry);
    try {
      await conn.connect();
    } catch (err) {
      this.connections.delete(entry.name);
      throw err;
    }
    this.connections.set(entry.name, conn);
    return conn;
  }

  /** Returns false when the connection is missing or the server no longer responds. */
  async isHealthy(name: string): Promise<boolean> {
    const conn = this.connections.get(name);
    if (!conn?.isConnected) return false;
    try {
      await conn.ping();
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (conn) {
      await conn.disconnect();
      this.connections.delete(name);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [name] of this.connections) {
      await this.disconnect(name);
    }
  }

  getConnection(name: string): McpClientConnection | undefined {
    return this.connections.get(name);
  }

  isConnected(name: string): boolean {
    return this.connections.get(name)?.isConnected ?? false;
  }

  getAllTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.isConnected) tools.push(...conn.tools);
    }
    return tools;
  }

  getAllResources(): McpResource[] {
    const resources: McpResource[] = [];
    for (const conn of this.connections.values()) {
      if (conn.isConnected) resources.push(...conn.resources);
    }
    return resources;
  }

  getAllPrompts(): McpPrompt[] {
    const prompts: McpPrompt[] = [];
    for (const conn of this.connections.values()) {
      if (conn.isConnected) prompts.push(...conn.prompts);
    }
    return prompts;
  }

  get connectedCount(): number {
    let count = 0;
    for (const conn of this.connections.values()) {
      if (conn.isConnected) count++;
    }
    return count;
  }
}

export { McpClientConnection } from './connection.js';
export type { McpClientConnectionState } from './connection.js';
export { mcpToolToAgentTool, mcpResourceToInfo, mcpPromptToInfo } from './bridge.js';
export type { McpToolDefinition } from './bridge.js';
