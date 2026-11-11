import { LlmEngagementJudge } from '@zhin.js/agent/runtime';
import { createInvocationCompletion, invocationModel } from '../../../../../agent/src/model-runtime/completion.js';
import { codexProvider } from '../../../../../ai/src/providers/subscriptions.js';
import { openAiProvider } from '../../../../../ai/src/providers/api-key.js';
import { driverFixture, callContext, sse } from '../../../../../ai/tests/providers/fixtures.js';

it.each(['codex', 'api-key'] as const)('uses the selected %s Profile parameters for the real ambient judge call without implicit sampling/output overrides', async kind => {
  const requests: Request[] = [], text = JSON.stringify({ engage: true, confidence: 0.9, reason: 'synthetic' });
  const fixture = driverFixture({ definition: kind === 'codex' ? codexProvider : openAiProvider,
    model: { id: 'selected', protocol: kind === 'codex' ? 'codex-responses' : 'openai-chat', kinds: ['language'], streaming: true },
    parameters: kind === 'codex' ? { maxRetries: 0 } : { maxRetries: 0, temperature: 0.7, maxOutputTokens: 81 },
    fetch: async (url, init) => {
      requests.push(new Request(url, init));
      return kind === 'codex' ? sse([
        { type: 'response.created', response: { id: 'resp_synthetic', created_at: 1, model: 'selected' } },
        { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_synthetic' } },
        { type: 'response.output_text.delta', item_id: 'msg_synthetic', output_index: 0, content_index: 0, delta: text },
        { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_synthetic' } },
        { type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 2 } } },
      ]) : Response.json({ id: 'chat_synthetic', object: 'chat.completion', created: 1, model: 'selected',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
    } });
  const scope = await fixture.runtime.openScope({ context: callContext });
  try {
    const binding = await scope.resolve({ kind: 'language', purpose: 'ambient' });
    const judge = new LlmEngagementJudge(createInvocationCompletion({ binding, client: scope.client, purpose: 'ambient' }), invocationModel(binding));
    await expect(judge.judge({ botName: 'bot', recent: ['hello bot'], signal: new AbortController().signal })).resolves.toEqual({ engage: true, confidence: 0.9, reason: 'synthetic' });
    expect(requests).toHaveLength(1); const body = await requests[0].json();
    expect(body.model).toBe('selected');
    if (kind === 'codex') {
      expect(requests[0].url).toBe('https://chatgpt.com/backend-api/codex/responses');
      expect(body).toMatchObject({ stream: true, store: false });
      expect(body).not.toHaveProperty('temperature'); expect(body).not.toHaveProperty('max_output_tokens');
    } else expect(body).toMatchObject({ temperature: 0.7, max_tokens: 81 });
    expect(JSON.stringify(body)).toContain('engage'); // Structured-output contract remains present.
  } finally { await scope.close(); fixture.runtime.retire(); }
});
