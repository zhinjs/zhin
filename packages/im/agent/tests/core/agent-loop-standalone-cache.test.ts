import { AiHttpTransport, createLlmApiRuntime, createSdkProviderAdapter, type ProviderInstanceConfig } from '@zhin.js/ai';
import { runAgentLoopStandaloneTurn } from '../../src/core/agent-loop-standalone.js';

it('reuses a standalone transport without reusing a cache for changed system content', async () => {
  const requests: Array<{ url: string; method: string; body: Record<string, any> }> = [];
  let created = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { url: String(input instanceof Request ? input.url : input), method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : {} };
    requests.push(request);
    if (request.url.endsWith('/cachedContents')) return Response.json({ name: `cachedContents/c${++created}` });
    if (request.method === 'DELETE') return Response.json({});
    const payload = { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1, totalTokenCount: 5 } };
    return new Response(`data: ${JSON.stringify(payload)}\r\n\r\n`, { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;
  const model = 'gemini-3.8-flash';
  const config: ProviderInstanceConfig = { sdk: 'google', apiKey: 'synthetic-key', models: [model], contextCache: { mode: 'explicit' } };
  const provider = createSdkProviderAdapter('mock', config, new AiHttpTransport({ fetch }))!;
  const llmRuntime = createLlmApiRuntime([{ alias: 'mock', config, models: [model], fetch }], () => [model]);
  const original = 'Synthetic standalone policy. '.repeat(400);
  try {
    for (const [index, systemPrompt] of [original, original, `${original} New policy.`].entries()) {
      const result = await runAgentLoopStandaloneTurn({ provider, llmRuntime, model, systemPrompt,
        tools: [], userInput: `TASK_${index}`, maxIterations: 1, directExecution: false });
      expect(result.content).toBe('ok');
    }
    const creates = requests.filter(request => request.url.endsWith('/cachedContents'));
    const generations = requests.filter(request => request.url.includes(':streamGenerateContent'));
    expect(creates).toHaveLength(2);
    expect(generations.map(request => request.body.cachedContent))
      .toEqual(['cachedContents/c1', 'cachedContents/c1', 'cachedContents/c2']);
    expect(creates[1]!.body.systemInstruction.parts[0].text).toContain('New policy.');
    expect(requests.filter(request => request.method === 'DELETE')).toHaveLength(1);
    expect(JSON.stringify(generations[2]!.body.contents)).toContain('TASK_2');
    expect(JSON.stringify(generations[2]!.body.contents)).not.toMatch(/TASK_0|TASK_1/);
    expect(JSON.stringify(requests)).not.toContain('synthetic-key');
  } finally {
    await provider.dispose();
  }
});
