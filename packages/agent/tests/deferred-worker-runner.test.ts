import { describe, it, expect, vi } from 'vitest';
import type { AgentTool, AIProvider } from '@zhin.js/ai';
import { DeferredWorkerRunner } from '../src/deferred-worker-runner.js';

function makeTool(name: string, description = 'test'): AgentTool {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {} },
    execute: async () => `ok:${name}`,
  };
}

describe('DeferredWorkerRunner', () => {
  it('loads deferred tools and returns summary', async () => {
    const chat = vi.fn().mockResolvedValue({
      choices: [{
        message: { role: 'assistant', content: 'Star count is 64' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const provider = {
      name: 'mock',
      models: ['test-model'],
      chat,
    } as unknown as AIProvider;

    const deferredCatalog = [makeTool('github_star', 'star repo')];
    const allByName = new Map<string, AgentTool>([
      ['github_star', deferredCatalog[0]],
      ['bash', makeTool('bash')],
      ['read_file', makeTool('read_file')],
    ]);

    const runner = new DeferredWorkerRunner();
    const result = await runner.runSync({
      goal: 'Check stars for zhinjs/qq-official-bot',
      toolQuery: 'github star',
      deferredCatalog,
      workerBaseTools: [allByName.get('bash')!, allByName.get('read_file')!],
      allToolsByName: allByName,
      origin: { platform: 'qq', senderId: 'u1' },
      maxToolResults: 5,
      provider,
      maxIterations: 3,
    });

    expect(result.status).toBe('ok');
    expect(result.loadedToolNames).toContain('github_star');
    expect(result.summary).toContain('64');
    expect(chat).toHaveBeenCalled();
  });

  it('returns error when no tools match query', async () => {
    const provider = {
      name: 'mock',
      models: ['test-model'],
      chat: vi.fn(),
    } as unknown as AIProvider;

    const runner = new DeferredWorkerRunner();
    const result = await runner.runSync({
      goal: 'do something',
      toolQuery: 'zzzznonexistent',
      deferredCatalog: [makeTool('github_star')],
      workerBaseTools: [],
      allToolsByName: new Map(),
      origin: {},
      maxToolResults: 5,
      provider,
    });

    expect(result.status).toBe('error');
    expect(result.loadedToolNames).toEqual([]);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it('sanitizes noisy html payloads in worker summary', async () => {
    const chat = vi.fn().mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: [
            '【bash】[执行] STDOUT:',
            '200',
            '<!DOCTYPE html><html><head><script>window.location.assign("/antibot/verifycode")</script></head><body>captcha</body></html>',
            'Final finding: source site blocks scraping, switch to web_search results.',
          ].join('\n'),
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const provider = {
      name: 'mock',
      models: ['test-model'],
      chat,
    } as unknown as AIProvider;

    const deferredCatalog = [makeTool('web_search', 'search web')];
    const allByName = new Map<string, AgentTool>([
      ['web_search', deferredCatalog[0]],
      ['bash', makeTool('bash')],
      ['read_file', makeTool('read_file')],
    ]);

    const runner = new DeferredWorkerRunner();
    const result = await runner.runSync({
      goal: 'Find Chengdu house price trends',
      toolQuery: 'web search',
      deferredCatalog,
      workerBaseTools: [allByName.get('bash')!, allByName.get('read_file')!],
      allToolsByName: allByName,
      origin: { platform: 'qq', senderId: 'u1' },
      maxToolResults: 5,
      provider,
      maxIterations: 3,
    });

    const payload = JSON.parse(result.summary) as { summary: string };
    expect(payload.summary).toContain('Final finding');
    expect(payload.summary).toContain('（已省略无关的页面/脚本噪声）');
    expect(payload.summary.toLowerCase()).not.toContain('<html');
  });
});
