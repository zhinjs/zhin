import type { ProviderFixtureConfig } from '../../../ai/tests/helpers/provider-fixture-config.js';
import { executionBundle } from '../helpers/execution-bundle.js';

import { fixedProfileClient } from '../../../ai/tests/helpers/fixed-profile-client.js';
import { runAgentLoopStandaloneTurn } from '../../src/core/agent-loop-standalone.js';

it('reuses a standalone transport without reusing a cache for changed system content', async () => {
  const requests: Array<{ url: string; method: string; body: Record<string, any> }> = [];
  let created = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const wire = new Request(input, init), text = wire.body ? await wire.text() : '';
    const request = { url: wire.url, method: wire.method, body: text ? JSON.parse(text) : {} };
    requests.push(request);
    if (request.url.endsWith('/cachedContents')) return Response.json({ name: `cachedContents/c${++created}` });
    if (request.method === 'DELETE') return Response.json({});
    const payload = { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1, totalTokenCount: 5 } };
    return request.url.includes(':streamGenerateContent')
      ? new Response(`data: ${JSON.stringify(payload)}\r\n\r\n`, { headers: { 'content-type': 'text/event-stream' } }) : Response.json(payload);
  }) as typeof globalThis.fetch;
  const model = 'gemini-3.8-flash';
  const config: ProviderFixtureConfig = { sdk: 'google', apiKey: 'synthetic-key', models: [model], contextCache: { mode: 'explicit' } };
  const provider = fixedProfileClient(config, fetch);
  const original = 'Synthetic standalone policy. '.repeat(400);
  try {
    for (const [index, systemPrompt] of [original, original, `${original} New policy.`].entries()) {
      const result = await runAgentLoopStandaloneTurn({ execution: executionBundle({ model: provider.model, completion: provider.completion }),
systemPrompt,
tools: [],
userInput: `TASK_${index}`,
maxIterations: 1,
directExecution: false });
      expect(result.content).toBe('ok');
    }
    const creates = requests.filter(request => request.url.endsWith('/cachedContents'));
    const generations = requests.filter(request => /:(?:generateContent|streamGenerateContent)/.test(request.url));
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
