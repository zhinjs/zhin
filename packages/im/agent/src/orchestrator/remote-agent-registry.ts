/**
 * RemoteAgentRegistry — A2A Agent Card discovery + Client cache.
 */
import { createRequire } from 'node:module';
import { getLogger } from '@zhin.js/logger';
import type { AIConfig } from '@zhin.js/ai';
import type { AgentCard } from '@a2a-js/sdk';
import { resolveConfigEnvString } from '../utils/config-env.js';

const logger = getLogger('RemoteAgentRegistry');
const requirePeer = createRequire(import.meta.url);

export interface RemoteAgentEntry {
  id: string;
  name: string;
  cardUrl: string;
  token?: string;
  roles: string[];
  description: string;
  card?: AgentCard;
}

export interface RemoteAgentHealth {
  id: string;
  healthy: boolean;
  error?: string;
}

import type { Client } from '@a2a-js/sdk/client';

function isA2aSdkInstalled(): boolean {
  try {
    requirePeer.resolve('@a2a-js/sdk/package.json');
    return true;
  } catch {
    return false;
  }
}

function parseRemoteAgents(config: AIConfig | undefined): RemoteAgentEntry[] {
  const raw = config?.remoteAgents;
  if (!raw?.length) return [];
  const out: RemoteAgentEntry[] = [];
  for (const item of raw) {
    if (!item?.id?.trim() || !item.cardUrl?.trim()) continue;
    const cardUrl = resolveConfigEnvString(item.cardUrl) ?? item.cardUrl;
    const token = item.token ? (resolveConfigEnvString(item.token) ?? item.token) : undefined;
    out.push({
      id: item.id.trim(),
      name: item.name?.trim() || item.id.trim(),
      cardUrl: cardUrl.trim(),
      token,
      roles: Array.isArray(item.roles) ? item.roles.map(String) : [],
      description: item.description?.trim() || '',
    });
  }
  return out;
}

async function fetchAgentCard(cardUrl: string): Promise<AgentCard> {
  const res = await fetch(cardUrl, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Agent Card fetch failed (${res.status}): ${cardUrl}`);
  }
  return res.json() as Promise<AgentCard>;
}

export class RemoteAgentRegistry {
  private entries = new Map<string, RemoteAgentEntry>();
  private health = new Map<string, RemoteAgentHealth>();
  private clients = new Map<string, Client>();

  loadFromConfig(config: AIConfig | undefined): void {
    this.entries.clear();
    this.clients.clear();
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

  supportsStreaming(agentId: string): boolean {
    const card = this.entries.get(agentId)?.card;
    return card?.capabilities?.streaming === true;
  }

  async refreshCard(agentId: string): Promise<AgentCard> {
    const agent = this.entries.get(agentId);
    if (!agent) throw new Error(`Remote agent "${agentId}" not registered`);
    const card = await fetchAgentCard(agent.cardUrl);
    agent.card = card;
    this.clients.delete(agentId);
    return card;
  }

  async ensureCard(agentId: string): Promise<AgentCard> {
    const agent = this.entries.get(agentId);
    if (!agent) throw new Error(`Remote agent "${agentId}" not registered`);
    if (agent.card) return agent.card;
    return this.refreshCard(agentId);
  }

  async getA2aClient(agentId: string): Promise<Client> {
    if (!isA2aSdkInstalled()) {
      throw new Error('@a2a-js/sdk is not installed — required for A2A remote_mesh');
    }
    let client = this.clients.get(agentId);
    if (client) return client;

    const agent = this.entries.get(agentId);
    if (!agent) throw new Error(`Remote agent "${agentId}" not registered`);

    await this.ensureCard(agentId);

    const {
      ClientFactory,
      JsonRpcTransportFactory,
      RestTransportFactory,
    } = await import('@a2a-js/sdk/client');
    const token = agent.token ?? '';

    const fetchImpl: typeof fetch = token
      ? (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set('Authorization', `Bearer ${token}`);
          return fetch(input, { ...init, headers });
        }
      : fetch;

    const factory = new ClientFactory({
      transports: [
        new JsonRpcTransportFactory({ fetchImpl }),
        new RestTransportFactory({ fetchImpl }),
      ],
    });

    client = await factory.createFromAgentCard(agent.card!);
    this.clients.set(agentId, client);
    return client;
  }

  async dispose(): Promise<void> {
    this.clients.clear();
    this.entries.clear();
    this.health.clear();
  }

  async healthCheckAll(): Promise<RemoteAgentHealth[]> {
    const results: RemoteAgentHealth[] = [];
    for (const agent of this.entries.values()) {
      results.push(await this.pingAgent(agent.id));
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
      await this.refreshCard(agentId);
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

export function getRemoteAgentRegistry(): RemoteAgentRegistry {
  if (!globalRegistry) {
    globalRegistry = new RemoteAgentRegistry();
  }
  return globalRegistry;
}

export async function initRemoteAgentRegistry(config: AIConfig | undefined): Promise<RemoteAgentRegistry> {
  const registry = getRemoteAgentRegistry();
  registry.loadFromConfig(config);
  for (const entry of registry.list()) {
    try {
      await registry.refreshCard(entry.id);
    } catch (err) {
      logger.debug(`Initial Agent Card fetch failed for ${entry.id}:`, err);
    }
  }
  return registry;
}

export async function disposeRemoteAgentRegistry(): Promise<void> {
  if (globalRegistry) {
    await globalRegistry.dispose();
    globalRegistry = null;
  }
}
