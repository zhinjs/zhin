/**
 * RemoteAgentRegistry — static ai.remoteAgents + health check (Agent Mesh v1).
 */
import { Logger } from '@zhin.js/logger';
import type { AIConfig } from '@zhin.js/ai';
import { resolveConfigEnvString } from '../utils/config-env.js';
import { McpClientConnection } from '../mcp-client/connection.js';
import type { McpServerEntry } from './types.js';

const logger = new Logger(null, 'RemoteAgentRegistry');

export interface RemoteAgentEntry {
  id: string;
  name: string;
  url: string;
  token?: string;
  roles: string[];
  description: string;
}

export interface RemoteAgentHealth {
  id: string;
  healthy: boolean;
  error?: string;
}

function parseRemoteAgents(config: AIConfig | undefined): RemoteAgentEntry[] {
  const raw = config?.remoteAgents;
  if (!raw?.length) return [];
  const out: RemoteAgentEntry[] = [];
  for (const item of raw) {
    if (!item?.id?.trim() || !item.url?.trim()) continue;
    const url = resolveConfigEnvString(item.url) ?? item.url;
    const token = item.token ? (resolveConfigEnvString(item.token) ?? item.token) : undefined;
    out.push({
      id: item.id.trim(),
      name: item.name?.trim() || item.id.trim(),
      url: url.trim(),
      token,
      roles: Array.isArray(item.roles) ? item.roles.map(String) : [],
      description: item.description?.trim() || '',
    });
  }
  return out;
}

export class RemoteAgentRegistry {
  private entries = new Map<string, RemoteAgentEntry>();
  private health = new Map<string, RemoteAgentHealth>();
  private connections = new Map<string, McpClientConnection>();

  loadFromConfig(config: AIConfig | undefined): void {
    this.entries.clear();
    for (const entry of parseRemoteAgents(config)) {
      this.entries.set(entry.id, entry);
    }
  }

  list(): RemoteAgentEntry[] {
    return [...this.entries.values()];
  }

  get(id: string): RemoteAgentEntry | undefined {
    return this.entries.get(id);
  }

  getHealth(id: string): RemoteAgentHealth | undefined {
    return this.health.get(id);
  }

  toMcpEntry(agent: RemoteAgentEntry): McpServerEntry {
    const headers: Record<string, string> = {};
    if (agent.token) {
      headers.Authorization = `Bearer ${agent.token}`;
    }
    return {
      name: `remote-agent:${agent.id}`,
      transport: 'streamable-http',
      url: agent.url,
      headers,
    };
  }

  async getConnection(agentId: string): Promise<McpClientConnection> {
    const agent = this.entries.get(agentId);
    if (!agent) throw new Error(`Remote agent "${agentId}" not registered`);
    let conn = this.connections.get(agentId);
    if (conn && conn.isConnected) return conn;
    if (conn) {
      try { await conn.disconnect(); } catch { /* ignore */ }
      this.connections.delete(agentId);
    }
    conn = new McpClientConnection(this.toMcpEntry(agent));
    try {
      await conn.connect();
    } catch (err) {
      this.connections.delete(agentId);
      throw err;
    }
    this.connections.set(agentId, conn);
    return conn;
  }

  async dispose(): Promise<void> {
    for (const [agentId, conn] of this.connections.entries()) {
      try {
        await conn.disconnect();
      } catch (err) {
        logger.debug(`Failed to disconnect remote agent ${agentId}:`, err);
      }
    }
    this.connections.clear();
    this.entries.clear();
    this.health.clear();
  }

  async healthCheckAll(): Promise<RemoteAgentHealth[]> {
    const results: RemoteAgentHealth[] = [];
    for (const agent of this.entries.values()) {
      const health = await this.pingAgent(agent.id);
      results.push(health);
    }
    return results;
  }

  async pingAgent(agentId: string): Promise<RemoteAgentHealth> {
    const agent = this.entries.get(agentId);
    if (!agent) {
      const h = { id: agentId, healthy: false, error: 'not registered' };
      this.health.set(agentId, h);
      return h;
    }
    try {
      const conn = await this.getConnection(agentId);
      await conn.ping();
      const h = { id: agentId, healthy: true };
      this.health.set(agentId, h);
      return h;
    } catch (err) {
      const h = {
        id: agentId,
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      };
      this.health.set(agentId, h);
      logger.debug(`Remote agent ${agentId} health check failed:`, err);
      return h;
    }
  }
}

let globalRegistry: RemoteAgentRegistry | null = null;

export function resetRemoteAgentRegistry(): void { globalRegistry = null; }

export function getRemoteAgentRegistry(): RemoteAgentRegistry {
  if (!globalRegistry) {
    globalRegistry = new RemoteAgentRegistry();
  }
  return globalRegistry;
}

export function initRemoteAgentRegistry(config: AIConfig | undefined): RemoteAgentRegistry {
  const registry = getRemoteAgentRegistry();
  registry.loadFromConfig(config);
  return registry;
}

export async function disposeRemoteAgentRegistry(): Promise<void> {
  if (globalRegistry) {
    await globalRegistry.dispose();
    globalRegistry = null;
  }
}
