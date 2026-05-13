import { describe, expect, it } from 'vitest';
import type { AIProvider } from '@zhin.js/ai';
import { DEFAULT_CONTEXT_TOKENS } from '@zhin.js/ai';
import { resolveContextBudget, pruneHistoryWithBudget } from '../src/zhin-agent/context-budget.js';
import { DEFAULT_CONFIG } from '../src/zhin-agent/config.js';
import type { ZhinAgentConfig } from '../src/zhin-agent/config.js';

function makeConfig(overrides: Partial<ZhinAgentConfig> = {}): Required<ZhinAgentConfig> {
  return { ...DEFAULT_CONFIG, ...overrides } as Required<ZhinAgentConfig>;
}

function makeProvider(contextWindow?: number): AIProvider {
  return {
    name: 'test',
    models: ['model-a'],
    contextWindow,
    chat: async () => ({ choices: [{ message: { role: 'assistant', content: 'ok' } }] } as any),
    chatStream: async function* () {},
  } as AIProvider;
}

describe('resolveContextBudget', () => {
  it('uses explicit config when it differs from the default', () => {
    const budget = resolveContextBudget({
      config: makeConfig({ contextTokens: 8192, maxHistoryShare: 0.25 }),
      provider: makeProvider(32768),
    });

    expect(budget).toEqual({
      contextWindow: 8192,
      maxHistoryShare: 0.25,
      source: 'config',
    });
  });

  it('uses provider contextWindow when config is default', () => {
    const budget = resolveContextBudget({
      config: makeConfig(),
      provider: makeProvider(32768),
    });

    expect(budget.contextWindow).toBe(32768);
    expect(budget.source).toBe('provider');
  });

  it('uses model registry contextWindow before provider fallback', () => {
    const budget = resolveContextBudget({
      config: makeConfig(),
      provider: makeProvider(32768),
      model: 'model-a',
      modelRegistry: {
        getModel: (providerName: string, modelId: string) =>
          providerName === 'test' && modelId === 'model-a'
            ? { id: 'model-a', contextWindow: 16384 }
            : undefined,
      } as any,
    });

    expect(budget.contextWindow).toBe(16384);
    expect(budget.source).toBe('model-registry');
  });

  it('falls back to default context tokens', () => {
    const budget = resolveContextBudget({
      config: makeConfig(),
      provider: makeProvider(),
    });

    expect(budget.contextWindow).toBe(DEFAULT_CONTEXT_TOKENS);
    expect(budget.source).toBe('default');
  });
});

describe('pruneHistoryWithBudget', () => {
  it('returns pruned messages and the budget used', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: 'x '.repeat(200),
    }));

    const result = pruneHistoryWithBudget({
      messages,
      config: makeConfig({ contextTokens: 1000, maxHistoryShare: 0.2 }),
      provider: makeProvider(),
    });

    expect(result.budget.contextWindow).toBe(1000);
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.result.droppedCount).toBeGreaterThan(0);
  });
});

