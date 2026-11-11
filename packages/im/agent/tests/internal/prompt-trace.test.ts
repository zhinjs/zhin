import { describe, expect, it, vi } from 'vitest';

const info = vi.hoisted(() => vi.fn());
vi.mock('@zhin.js/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zhin.js/logger')>()),
  getLogger: () => ({ info, warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  formatCompact: (fields: Record<string, unknown>) => JSON.stringify(fields),
}));

import { logPromptComposition } from '../../src/internal/prompt-trace.js';
import { estimatePromptTokens } from '../../src/prompt/estimate-tokens.js';

describe('logPromptComposition', () => {
  it('estimates CJK text with the shared estimator instead of chars / 4', () => {
    const systemPrompt = '你是一个乐于助人的助手。'.repeat(10);
    logPromptComposition({
      config: { promptTraceEnabled: true, promptTraceVerbose: false } as never,
      sessionId: 's',
      label: 'test',
      systemPrompt,
      historyMessages: [{ role: 'user', content: [{ type: 'text', text: '今天天气怎么样？' }] } as never],
      tools: [],
    });

    const logged = JSON.parse(String(info.mock.calls.at(-1)?.[0])) as { system: number; history: string; total: number };
    expect(logged.system).toBe(estimatePromptTokens(systemPrompt));
    // chars / 4 would have reported about a quarter of this.
    expect(logged.system).toBeGreaterThan(Math.ceil(systemPrompt.length / 4) * 3);
    expect(logged.history).toBe(`1msg/${estimatePromptTokens('今天天气怎么样？')}tok`);
    expect(logged.total).toBe(logged.system + estimatePromptTokens('今天天气怎么样？'));
  });
});
