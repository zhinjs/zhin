/**
 * RemoteAgentRegistry — A2A Agent Card discovery + Client cache.
 *
 * Instances are explicitly owned and disposed by the Root generation.
 */
import { createRequire } from 'node:module';
import { getLogger } from '@zhin.js/logger';
import type { AIConfig } from '@zhin.js/ai';
import type { AgentCard } from '@a2a-js/sdk';
import { resolveConfigEnvString } from '../utils/config-env.js';

const logger = getLogger('RemoteAgentRegistry');
const requirePeer = createRequire(import.meta.url);
const AGENT_CARD_FETCH_TIMEOUT_MS = 10_000;

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

function validateAgentCard(value: unknown, cardUrl: string): AgentCard {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid Agent Card from ${cardUrl}: expected an object`);
  }
  const card = value as Partial<AgentCard>;
  if (typeof card.name !== 'string' || !card.name.trim()) {
    throw new Error(`Invalid Agent Card from ${cardUrl}: name is required`);
  }
  if (typeof card.version !== 'string' || !card.version.trim()) {
    throw new Error(`Invalid Agent Card from ${cardUrl}: version is required`);
  }
  if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0
    || !card.capabilities || typeof card.capabilities !== 'object') {
    throw new Error(`Invalid Agent Card from ${cardUrl}: interfaces and capabilities are required`);
  }
  for (const [index, entry] of card.supportedInterfaces.entries()) {
    if (!entry || typeof entry !== 'object'
      || typeof entry.url !== 'string'
      || typeof entry.protocolVersion !== 'string'
      || (entry.protocolBinding !== 'JSONRPC' && entry.protocolBinding !== 'HTTP+JSON')) {
      throw new Error(`Invalid Agent Card from ${cardUrl}: unsupported interface at index ${index}`);
    }
    let protocol: string;
    try {
      protocol = new URL(entry.url).protocol;
    } catch {
      throw new Error(`Invalid Agent Card from ${cardUrl}: invalid interface URL at index ${index}`);
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(`Invalid Agent Card from ${cardUrl}: invalid interface protocol at index ${index}`);
    }
  }
  if (!Array.isArray(card.defaultInputModes) || !Array.isArray(card.defaultOutputModes) || !Array.isArray(card.skills)) {
    throw new Error(`Invalid Agent Card from ${cardUrl}: modes and skills must be arrays`);
  }
  return card as AgentCard;
}

function parseRemoteAgents(config: AIConfig | undefined): RemoteAgentEntry[] {
  const raw = config?.remoteAgents;
  if (!raw?.length) return [];
  const out: RemoteAgentEntry[] = [];
  const ids = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const configuredCardUrl = typeof item?.cardUrl === 'string' ? item.cardUrl.trim() : '';
    if (!id || !configuredCardUrl) {
      throw new Error(`Invalid ai.remoteAgents[${index}]: id and cardUrl are required`);
    }
    if (ids.has(id)) {
      throw new Error(`Invalid ai.remoteAgents[${index}]: duplicate id "${id}"`);
    }
    ids.add(id);
    const cardUrl = (resolveConfigEnvString(configuredCardUrl) ?? configuredCardUrl).trim();
    if (!cardUrl) {
      throw new Error(`Invalid ai.remoteAgents[${index}]: cardUrl resolved to an empty value`);
    }
    const token = item.token ? (resolveConfigEnvString(item.token) ?? item.token) : undefined;
    out.push({
      id,
      name: item.name?.trim() || id,
      cardUrl,
      token,
      roles: Array.isArray(item.roles) ? item.roles.map(String) : [],
      description: item.description?.trim() || '',
    });
  }
  return out;
}

async function fetchAgentCard(cardUrl: string, signal: AbortSignal): Promise<AgentCard> {
  const res = await fetch(cardUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(AGENT_CARD_FETCH_TIMEOUT_MS)]),
  });
  if (!res.ok) {
    throw new Error(`Agent Card fetch failed (${res.status}): ${cardUrl}`);
  }
  return validateAgentCard(await res.json(), cardUrl);
}

export class RemoteAgentRegistry {
  private entries = new Map<string, RemoteAgentEntry>();
  private health = new Map<string, RemoteAgentHealth>();
  private clients = new Map<string, Client>();
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private readonly operations = new Set<Promise<void>>();
  private readonly taskOperations = new Set<string>();

  constructor(parentSignal: AbortSignal = new AbortController().signal) {
    this.signal = AbortSignal.any([parentSignal, this.controller.signal]);
  }

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

  async refreshCard(
    agentId: string,
    signal: AbortSignal = this.signal,
  ): Promise<AgentCard> {
    const agent = this.entries.get(agentId);
    if (!agent) throw new Error(`Remote agent "${agentId}" not registered`);
    const card = await fetchAgentCard(agent.cardUrl, signal);
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

    const lifecycleSignal = this.signal;
    const fetchImpl: typeof fetch = token
      ? (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set('Authorization', `Bearer ${token}`);
          const signal = init?.signal
            ? AbortSignal.any([lifecycleSignal, init.signal])
            : lifecycleSignal;
          return fetch(input, { ...init, headers, signal });
        }
      : (input, init) => fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([lifecycleSignal, init.signal])
            : lifecycleSignal,
        });

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

  track(operation: (signal: AbortSignal) => Promise<void>): void {
    void this.run(operation).catch((error) => {
      logger.error('Tracked remote Agent operation failed:', error);
    });
  }

  trackTask(taskId: string, operation: (signal: AbortSignal) => Promise<void>): boolean {
    if (this.taskOperations.has(taskId)) return false;
    this.taskOperations.add(taskId);
    try {
      this.track(async (signal) => {
        try {
          await operation(signal);
        } finally {
          this.taskOperations.delete(taskId);
        }
      });
      return true;
    } catch (error) {
      this.taskOperations.delete(taskId);
      throw error;
    }
  }

  run<TResult>(operation: (signal: AbortSignal) => Promise<TResult>): Promise<TResult> {
    this.signal.throwIfAborted();
    let started: Promise<TResult>;
    try {
      started = operation(this.signal);
    } catch (error) {
      started = Promise.reject(error);
    }
    const running = started
      .then(() => undefined, () => undefined)
      .finally(() => {
        this.operations.delete(running);
      });
    this.operations.add(running);
    return started;
  }

  async dispose(): Promise<void> {
    this.controller.abort(new Error('Remote Agent generation disposed'));
    await Promise.allSettled([...this.operations]);
    this.clients.clear();
    this.entries.clear();
    this.health.clear();
    this.taskOperations.clear();
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

export async function createRemoteAgentRegistry(
  config: AIConfig | undefined,
  signal: AbortSignal,
): Promise<RemoteAgentRegistry> {
  const registry = new RemoteAgentRegistry(signal);
  registry.loadFromConfig(config);
  for (const entry of registry.list()) {
    signal.throwIfAborted();
    await registry.refreshCard(entry.id, signal);
  }
  return registry;
}
