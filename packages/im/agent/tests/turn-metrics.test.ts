import { describe, expect, it } from 'vitest';
import {
  addUsage,
  formatAiHandlerTurnTable,
  formatOutputElementsPreview,
} from '../src/turn/turn-metrics.js';

describe('turn-metrics', () => {
  it('formatAiHandlerTurnTable 含指标与内容预览', () => {
    const log = formatAiHandlerTurnTable(
      {
        usage: { prompt_tokens: 4298, completion_tokens: 54, total_tokens: 4352 },
        path: 'agent',
        iterations: 1,
        model: 'mimo-v2.5-free',
        userInput: '你好',
        thinking: '用户在打招呼',
        output: '你好！有什么可以帮你的？',
      },
      5172,
    );
    expect(log).toContain('AI Handler');
    expect(log).toContain('5172');
    expect(log).toContain('4352');
    expect(log).toContain('agent');
    expect(log).toContain('mimo-v2.5-free');
    expect(log).toContain('用户输入');
    expect(log).toContain('你好');
    expect(log).toContain('思考');
    expect(log).toContain('用户在打招呼');
    expect(log).toContain('输出');
    expect(log).toContain('有什么可以帮你的');
    expect(log).toContain('╭');
    expect(log).toContain('╯');
  });

  it('formatAiHandlerTurnTable 含子 agent token 明细', () => {
    const log = formatAiHandlerTurnTable(
      {
        usage: { prompt_tokens: 300, completion_tokens: 200, total_tokens: 500 },
        subagentUsage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
        path: 'agent',
        iterations: 2,
        model: 'deepseek-v4-flash',
      },
      12000,
    );
    expect(log).toContain('500');
    expect(log).toContain('main 300 + sub 200');
  });

  it('formatAiHandlerTurnTable 空内容显示占位', () => {
    const log = formatAiHandlerTurnTable(
      {
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        path: 'chat',
        model: 'qwen3:14b',
      },
      800,
    );
    expect(log).toContain('用户输入');
    expect(log).toContain('思考');
    expect(log).toContain('输出');
  });

  it('formatOutputElementsPreview 拼接文本与图片', () => {
    expect(formatOutputElementsPreview([
      { type: 'text', content: '回复' },
      { type: 'image', url: 'https://example.com/a.png' },
    ])).toBe('回复\n<image url="https://example.com/a.png"/>');
  });

  it('addUsage 应累加', () => {
    const target = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    addUsage(target, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    addUsage(target, { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 });
    expect(target.total_tokens).toBe(45);
  });
});
