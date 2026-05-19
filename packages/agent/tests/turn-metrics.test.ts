import { describe, expect, it } from 'vitest';
import { addUsage, formatAiHandlerCompleteLog } from '../src/zhin-agent/turn-metrics.js';

describe('turn-metrics', () => {
  it('formatAiHandlerCompleteLog 紧凑格式含子 agent', () => {
    const log = formatAiHandlerCompleteLog(
      {
        usage: { prompt_tokens: 300, completion_tokens: 200, total_tokens: 500 },
        subagentUsage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
        path: 'agent',
        iterations: 2,
        model: 'deepseek-v4-flash',
      },
      12000,
    );
    expect(log).toBe(
      '[AI Handler] total_ms: 12000; usage: 500 (In 300 / Out 200); main 300 + sub 200; mode: agent; iter: 2; model: deepseek-v4-flash',
    );
  });

  it('formatAiHandlerCompleteLog 无子 agent 时省略 main/sub', () => {
    const log = formatAiHandlerCompleteLog(
      {
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        path: 'chat',
        model: 'qwen3:14b',
      },
      800,
    );
    expect(log).toBe(
      '[AI Handler] total_ms: 800; usage: 150 (In 100 / Out 50); mode: chat; model: qwen3:14b',
    );
  });

  it('addUsage 应累加', () => {
    const target = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    addUsage(target, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    addUsage(target, { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 });
    expect(target.total_tokens).toBe(45);
  });
});
