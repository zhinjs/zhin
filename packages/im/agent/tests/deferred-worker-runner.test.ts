import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetLlmApiRegistryForTests, type AgentTool, type AIProvider } from '@zhin.js/ai';

import { wireMockLlmApi, assistantTextReply, assistantToolCallReply } from './helpers/mock-llm-api.js';
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
  beforeEach(() => {
    resetLlmApiRegistryForTests();
  });

  it('loads deferred tools and returns summary', async () => {
    const llm = wireMockLlmApi({
      models: ['test-model'],
      responder: () => assistantTextReply('Star count is 64'),
    });
    const provider = llm.provider as unknown as AIProvider;

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
    expect(llm.calls.length).toBeGreaterThan(0);
  });

  it('returns error when no tools match query', async () => {
    const llm = wireMockLlmApi({ models: ['test-model'] });
    const provider = llm.provider as unknown as AIProvider;

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
    expect(llm.calls).toHaveLength(0);
  });

  it('sanitizes noisy html payloads in worker summary', async () => {
    const llm = wireMockLlmApi({
      models: ['test-model'],
      responder: () => assistantTextReply([
        '【bash】[执行] STDOUT:',
        '200',
        '<!DOCTYPE html><html><head><script>window.location.assign("/antibot/verifycode")</script></head><body>captcha</body></html>',
        'Final finding: source site blocks scraping, switch to web_search results.',
      ].join('\n')),
    });
    const provider = llm.provider as unknown as AIProvider;

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

  it('falls back to tool call results when final content is raw tool_call markup', async () => {
    let phase = 0;
    const llm = wireMockLlmApi({
      models: ['test-model'],
      responder: () => {
        phase += 1;
        return phase === 1
          ? assistantToolCallReply([{ id: 'tc1', name: 'bash', arguments: {} }])
          : assistantTextReply('<tool_call>read_file</tool_call>');
      },
    });
    const provider = llm.provider as unknown as AIProvider;

    const bash = makeTool('bash');
    const readFile = makeTool('read_file');
    const allByName = new Map<string, AgentTool>([
      ['bash', bash],
      ['read_file', readFile],
    ]);

    const runner = new DeferredWorkerRunner();
    const result = await runner.runSync({
      goal: 'list project files',
      deferredCatalog: [],
      workerBaseTools: [bash, readFile],
      allToolsByName: allByName,
      origin: {},
      maxToolResults: 5,
      provider,
      maxIterations: 5,
    });

    const payload = JSON.parse(result.summary) as { summary: string; status: string };
    expect(payload.summary).toContain('ok:bash');
    expect(payload.summary).not.toContain('Tool returned non-plain control payload');
  });

  it('emits lifecycle events', async () => {
    const llm = wireMockLlmApi({
      models: ['test-model'],
      responder: () => assistantTextReply('Deferred done'),
    });
    const provider = llm.provider as unknown as AIProvider;

    const deferredCatalog = [makeTool('github_star', 'star repo')];
    const allByName = new Map<string, AgentTool>([
      ['github_star', deferredCatalog[0]],
      ['bash', makeTool('bash')],
    ]);
    const onEvent = vi.fn();

    const runner = new DeferredWorkerRunner();
    await runner.runSync({
      goal: 'Check stars',
      toolQuery: 'github star',
      deferredCatalog,
      workerBaseTools: [allByName.get('bash')!],
      allToolsByName: allByName,
      origin: { platform: 'qq', senderId: 'u1' },
      maxToolResults: 5,
      provider,
      maxIterations: 3,
      onEvent,
    });

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'start', goal: 'Check stars' }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'finish', goal: 'Check stars', status: 'ok' }));
  });
});
