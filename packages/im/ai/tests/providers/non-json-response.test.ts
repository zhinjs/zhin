/**
 * #1250 service-baseurl-immutable: an OpenAI-compatible service whose address lacks `/v1`
 * gets the site's HTML home page with HTTP 200. The request path reports that clearly
 * (`non_json_response`) instead of an opaque SDK parse failure.
 */
import { openAiCompatibleProvider } from '../../src/providers/api-key.js';
import { assertStructuredResponse } from '../../src/providers/sdk-execution.js';
import { classifyProviderError, describeProviderFailure } from '../../src/llm/provider-resilience.js';
import { callContext, chatReply, driverFixture, prompt, sse } from './fixtures.js';

const html = (type = 'text/html; charset=utf-8') => new Response('\n  <!doctype html><html><body>Welcome</body></html>', { status: 200, headers: { 'content-type': type } });

describe('non-JSON successful model responses', () => {
  it.each([
    ['text/html', html()],
    ['untyped HTML', new Response('<html>home</html>', { status: 200 })],
    ['HTML served as text/plain', html('text/plain')],
  ])('rejects %s as non_json_response, never retried', async (_name, response) => {
    const error = await assertStructuredResponse(response).then(() => undefined, (failure: unknown) => failure);
    expect(classifyProviderError(error)).toEqual({ kind: 'non_json_response', retryable: false, status: 200 });
    expect(describeProviderFailure('non_json_response')).toContain('可能少了 /v1');
  });

  it.each([
    ['JSON', new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['an event stream', new Response('data: {}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })],
    ['untyped JSON', new Response('{"ok":true}', { status: 200 })],
    ['an HTML error page (left to the HTTP status)', new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } })],
  ])('passes %s through untouched', async (_name, response) => {
    await expect(assertStructuredResponse(response)).resolves.toBeUndefined();
    expect(response.bodyUsed).toBe(false);
  });

  it('fails a real OpenAI-compatible request against a site home page clearly', async () => {
    const fixture = driverFixture({ definition: openAiCompatibleProvider,
      options: { baseUrl: 'https://byesu.example', compat: { appendV1: false } },
      model: { id: 'configured-model', kinds: ['language'], protocol: 'openai-chat', streaming: false },
      parameters: { maxRetries: 0 },
      fetch: async () => html(),
    });
    const client = await fixture.runtime.openOperation({ context: callContext });
    const error = await client.generate({ request: { context: prompt } }).then(() => undefined, (failure: unknown) => failure);
    expect(classifyProviderError(error).kind).toBe('non_json_response');
    await client.close();
  });

  it('is not retried under the default maxRetries', async () => {
    let requests = 0;
    const fixture = driverFixture({ definition: openAiCompatibleProvider,
      options: { baseUrl: 'https://byesu.example', compat: { appendV1: false } },
      model: { id: 'configured-model', kinds: ['language'], protocol: 'openai-chat', streaming: false },
      fetch: async () => { requests++; return html(); },
    });
    const client = await fixture.runtime.openOperation({ context: callContext });
    const error = await client.generate({ request: { context: prompt } }).then(() => undefined, (failure: unknown) => failure);
    expect(classifyProviderError(error).kind).toBe('non_json_response');
    expect(requests).toBe(1);
    await client.close();
  });

  it('keeps ordinary JSON and streaming replies working', async () => {
    const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://gateway.example/v1' },
      model: { id: 'configured-model', kinds: ['language'], protocol: 'openai-chat', streaming: true },
      parameters: { maxRetries: 0 },
      fetch: async (_url, init) => JSON.parse(String(init?.body ?? '{}')).stream ? sse([
        { id: 'c', created: 1, model: 'configured-model', choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }] },
      ]) : chatReply(),
    });
    const client = await fixture.runtime.openOperation({ context: callContext });
    await expect(client.generate({ request: { context: prompt } })).resolves.toMatchObject({ role: 'assistant' });
    const run = await client.stream({ request: { context: prompt } });
    let done = false;
    for await (const event of run) if (event.type === 'done') done = true;
    expect(done).toBe(true);
    await client.close();
  });
});
