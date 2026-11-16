import { describe, expect, it, vi } from 'vitest';
import { EMPTY_TOKEN_USAGE, type AssistantMessage, type Context, type Model } from '@zhin.js/ai';
import { summarizeProgress } from '../../src/core/progress-reporter.js';

const model = { id: 'mock-model', api: 'ai-sdk', provider: 'mock' } as unknown as Model;
const reply = (text: string): AssistantMessage => ({
  role: 'assistant', content: [{ type: 'text', text }], api: 'ai-sdk', provider: 'mock', model: 'mock-model',
  usage: { ...EMPTY_TOKEN_USAGE }, stopReason: 'stop', timestamp: 0,
});

describe('#1250 batch 29 review: progress summary input', () => {
  it('does not re-send base64 the model wrote earlier in the turn', async () => {
    const payload = Buffer.alloc(3000, 5).toString('base64');
    const complete = vi.fn(async (_model: Model, _context: Context) => reply('已经查完两个文件。'));
    const summary = await summarizeProgress({
      transport: { complete, completeSimple: complete },
      model,
      systemPrompt: 'system',
      messages: [reply(`草稿 ${payload}`)],
    });
    expect(summary).toBe('已经查完两个文件。');
    const sent = JSON.stringify(complete.mock.calls[0]![1].messages);
    expect(sent).toContain('[已省略 base64 数据（4000 字符），未提供给模型]');
    expect(sent).not.toContain(payload.slice(0, 64));
  });
});
