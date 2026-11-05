import { it, expect } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import { createNightlyInference } from './inference.js';
import { resolveNightlyProvider } from './providers.js';

it.each(['gemini', 'minimax'] as const)('routes every explicit nightly %s candidate through its fixed Profile and installed SDK without a provider directory', async id => {
  const requests: Request[] = [];
  const provider = resolveNightlyProvider({ NIGHTLY_PROVIDER: id, GEMINI_API_KEY: 'synthetic-google', MINIMAX_API_KEY: 'synthetic-minimax' });
  const inference = await createNightlyInference({ provider, modelIds: ['probe-first', id === 'gemini' ? 'gemini-3.5-flash-lite' : 'probe-second'], fetch: async (url, init) => {
    requests.push(new Request(url, init));
    return id === 'gemini' ? Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 } })
      : Response.json({ id: 'msg_probe', type: 'message', role: 'assistant', model: 'probe-second', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 3, output_tokens: 1 } });
  } });
  try {
    expect(requests).toHaveLength(0);
    const selected = inference.models[1];
    expect((await inference.port.complete(selected, { systemPrompt: '', messages: [createUserMessage('probe')] })).content).toEqual([{ type: 'text', text: 'done' }]);
    expect(requests).toHaveLength(1);
    const request = requests[0], body = await request.json();
    if (id === 'gemini') {
      expect(request.url).toContain('/models/gemini-3.5-flash-lite:generateContent'); expect(request.headers.get('x-goog-api-key')).toBe('synthetic-google');
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    } else {
      expect(body.model).toBe('probe-second'); expect(request.headers.get('authorization')).toBe('Bearer synthetic-minimax');
    }
    expect(() => inference.port.complete({ ...selected, id: 'unlisted' }, { systemPrompt: '', messages: [] })).toThrow('outside');
    expect(requests).toHaveLength(1);
  } finally { await inference.close(); }
  await expect(inference.port.complete(inference.models[0], { systemPrompt: '', messages: [] })).rejects.toMatchObject({ code: 'operation-closed' });
});
