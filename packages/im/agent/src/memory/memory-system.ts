import { getLlmTransportModel } from '@zhin.js/ai';
import type { ContextRepository } from '@zhin.js/ai';
import { resolveIMSessionIdFromMessage, type Message } from '@zhin.js/core';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import { beginTurnSession, type SessionIODeps } from '../session/session-io.js';
import type { MemoryStore, MemorySystemConfig } from './contracts.js';
import { ContextRepositoryMemoryStore } from './context-repository-store.js';
import { manualCompactSession } from './compaction-runtime.js';
import { AiCompactionStrategy } from './ai-compaction-strategy.js';

export class MemorySystem {
  private stores = new Map<string, MemoryStore>();

  constructor(private readonly _config: MemorySystemConfig) {}

  registerStore(name: string, store: MemoryStore): void {
    this.stores.set(name, store);
  }

  registerContextRepository(
    name: string,
    repository: ContextRepository,
    contextWindow: number,
  ): void {
    this.registerStore(name, new ContextRepositoryMemoryStore(repository, contextWindow));
  }

  private store(name: string = 'default'): MemoryStore {
    const store = this.stores.get(name);
    if (!store) {
      throw new Error(`MemoryStore '${name}' not registered`);
    }
    return store;
  }

  async load(sessionId: string, storeName: string = 'default') {
    return this.store(storeName).load(sessionId);
  }

  async save(
    sessionId: string,
    context: Parameters<MemoryStore['save']>[1],
    storeName: string = 'default',
  ): Promise<void> {
    await this.store(storeName).save(sessionId, context);
    if (this._config.compactionStrategy.shouldCompact(context)) {
      const compacted = await this._config.compactionStrategy.compact(context);
      await this.store(storeName).save(sessionId, compacted);
    }
  }

  async compactSessionForCommMessage(
    host: ZhinAgentPrivate,
    commMessage: Message,
    deps: SessionIODeps,
  ): Promise<{ ok: boolean; message: string }> {
    const sessionKey = resolveIMSessionIdFromMessage(commMessage);
    const { sessionId } = await beginTurnSession(deps, sessionKey, commMessage);
    const provider = host.getTurnProvider();
    const modelId = host.config.chatModel || provider.models[0] || '';
    const llmModel = getLlmTransportModel(provider.name, modelId);
    const contextWindow = llmModel.contextWindow ?? host.config.contextTokens;
    return manualCompactSession(host.contextRepository, {
      host,
      sessionId,
      commMessage,
      model: llmModel,
      compactionConfig: host.config.compaction,
      contextWindow,
      mode: 'text',
    });
  }
}

export function createMemorySystemForHost(host: ZhinAgentPrivate): MemorySystem {
  const provider = host.getTurnProvider();
  const modelId = host.config.chatModel || provider.models[0] || '';
  const llmModel = getLlmTransportModel(provider.name, modelId);
  const contextWindow = llmModel.contextWindow ?? host.config.contextTokens;
  const system = new MemorySystem({
    compactionStrategy: new AiCompactionStrategy(llmModel, host.config.compaction),
  });
  system.registerContextRepository('default', host.contextRepository, contextWindow);
  return system;
}

export const defaultMemorySystem = new MemorySystem({
  compactionStrategy: {
    shouldCompact: () => false,
    compact: async (ctx) => ctx,
  },
});
