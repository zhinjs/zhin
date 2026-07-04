/**
 * Legacy ChatMessage context budget helpers.
 * @deprecated Use ContextRepository compaction (transformContextWithCompaction) on AgentMessage history.
 */
import type { AIProvider, ChatMessage, PruneResult } from '@zhin.js/ai';
import {
  DEFAULT_CONTEXT_TOKENS,
  pruneHistoryForContext,
} from '@zhin.js/ai';
import type { ModelRegistry } from '@zhin.js/ai';
import type { ZhinAgentConfig } from './config.js';

export interface ResolvedContextBudget {
  contextWindow: number;
  maxHistoryShare: number;
  source: 'config' | 'model-registry' | 'provider' | 'default';
}

export interface PrunedHistory {
  messages: ChatMessage[];
  result: PruneResult;
  budget: ResolvedContextBudget;
}

function resolveRegistryWindow(
  registry: ModelRegistry | null | undefined,
  provider: AIProvider,
  model?: string,
): number | undefined {
  if (!registry || !model) return undefined;
  return registry.getCachedModelInfo(provider.name, model)?.contextWindow;
}

export function resolveContextBudget(params: {
  config: Required<ZhinAgentConfig>;
  provider: AIProvider;
  modelRegistry?: ModelRegistry | null;
  model?: string;
}): ResolvedContextBudget {
  const configured = params.config.contextTokens;
  if (configured && configured > 0 && configured !== DEFAULT_CONTEXT_TOKENS) {
    return {
      contextWindow: configured,
      maxHistoryShare: params.config.maxHistoryShare ?? 0.5,
      source: 'config',
    };
  }

  const registryWindow = resolveRegistryWindow(params.modelRegistry, params.provider, params.model);
  if (registryWindow && registryWindow > 0) {
    return {
      contextWindow: registryWindow,
      maxHistoryShare: params.config.maxHistoryShare ?? 0.5,
      source: 'model-registry',
    };
  }

  if (params.provider.contextWindow && params.provider.contextWindow > 0) {
    return {
      contextWindow: params.provider.contextWindow,
      maxHistoryShare: params.config.maxHistoryShare ?? 0.5,
      source: 'provider',
    };
  }

  return {
    contextWindow: configured || DEFAULT_CONTEXT_TOKENS,
    maxHistoryShare: params.config.maxHistoryShare ?? 0.5,
    source: 'default',
  };
}

export function pruneHistoryWithBudget(params: {
  messages: ChatMessage[];
  config: Required<ZhinAgentConfig>;
  provider: AIProvider;
  modelRegistry?: ModelRegistry | null;
  model?: string;
}): PrunedHistory {
  const budget = resolveContextBudget(params);
  const result = pruneHistoryForContext({
    messages: params.messages,
    maxContextTokens: budget.contextWindow,
    maxHistoryShare: budget.maxHistoryShare,
  });
  return {
    messages: result.messages,
    result,
    budget,
  };
}

