import { z } from 'zod';
import { codexProvider, claudeSubscriptionProvider, openCodeGoProvider, openCodeZenProvider } from '../../src/providers/subscriptions.js';
import { antigravityProvider } from '../../src/providers/antigravity.js';
import { antigravityOAuth } from '../../src/providers/oauth.js';
import { parseAgentMessageRow, serializeAgentMessage } from '../../src/memory/agent-db-models.js';
import { callContext, chatReply, driverFixture, prompt, sse } from './fixtures.js';
import { formatRedactedJson } from '../../src/llm/redact-request-body.js';

function codexReply(tool = false) {
  return sse([
    { type: 'response.created', response: { id: 'resp_local', created_at: 1, model: 'codex-local' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_local', encrypted_content: 'private-opaque' } },
    { type: 'response.reasoning_summary_part.added', item_id: 'rs_local', summary_index: 0 },
    { type: 'response.reasoning_summary_text.delta', item_id: 'rs_local', summary_index: 0, delta: 'considered' },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_local', encrypted_content: 'private-opaque' } },
    ...(tool ? [
      { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc_local', call_id: 'call_actual', name: 'lookup', arguments: '' } },
      { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'fc_local', delta: '{"value":1}' },
      { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id: 'fc_local', call_id: 'call_actual', name: 'lookup', arguments: '{"value":1}', status: 'completed' } },
    ] : [
      { type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'msg_local' } },
      { type: 'response.output_text.delta', item_id: 'msg_local', output_index: 1, content_index: 0, delta: 'done' },
      { type: 'response.output_item.done', output_index: 1, item: { type: 'message', id: 'msg_local' } },
    ]),
    { type: 'response.completed', response: { usage: { input_tokens: 20, input_tokens_details: { cached_tokens: 12 }, output_tokens: 4, output_tokens_details: { reasoning_tokens: 2 } } } },
  ]);
}

it('keeps Codex stateless tool history and encrypted reasoning across real serialization and later operation, but strips opaque state across sessions', async () => {
  const requests: Request[] = [];
  const observations: unknown[] = [];
  const fixture = driverFixture({ definition: codexProvider,
    model: { id: 'codex-local', kinds: ['language'], protocol: 'codex-responses', streaming: true, toolCalling: true }, parameters: { maxRetries: 0 },
    grant: { token: 'synthetic-oauth', headers: {}, revision: '1', metadata: { chatgptAccountId: 'routing-only' } },
    fetch: async (url, init) => { requests.push(new Request(url, init)); return codexReply(requests.length === 1); },
  });
  const first = await fixture.runtime.openOperation({ context: callContext });
  const initial = await first.generate({ request: { context: { ...prompt, tools: [{ name: 'lookup', description: 'synthetic', parameters: z.object({ value: z.number() }) }] } } });
  expect(initial.stopReason).toBe('toolCalls');
  expect(initial.content).toContainEqual(expect.objectContaining({ type: 'thinking', providerOptions: { openai: { itemId: 'rs_local', reasoningEncryptedContent: 'private-opaque' } } }));
  expect(initial.usage).toMatchObject({ input: 20, cacheRead: 12, output: 4 });
  const row = serializeAgentMessage(initial);
  const restored = parseAgentMessageRow(row);
  if (!restored || restored.role !== 'assistant') throw new Error('expected persisted assistant');
  expect(restored.providerStateScope).toEqual(initial.providerStateScope);
  await first.close();
  const followup = { context: { ...prompt, messages: [...prompt.messages, restored, { role: 'toolResult' as const, toolCallId: 'call_actual', toolName: 'lookup', content: [{ type: 'text' as const, text: 'result' }], isError: false, timestamp: 2 }] },
    options: { onRequest: (value: unknown) => { observations.push(value); } } };
  const second = await fixture.runtime.openOperation({ context: { ...callContext, operationId: 'second-turn' } });
  expect((await second.generate({ request: followup })).stopReason).toBe('stop');
  const body = await requests[1].json();
  expect(body).toMatchObject({ model: 'codex-local', store: false, stream: true, include: ['reasoning.encrypted_content'] });
  expect(body.prompt_cache_key).toMatch(/^[a-f0-9]{64}$/); expect(body).not.toHaveProperty('prompt_cache_retention');
  expect(body).not.toHaveProperty('previous_response_id'); expect(body).not.toHaveProperty('max_output_tokens');
  expect(body.input).toContainEqual(expect.objectContaining({ type: 'reasoning', encrypted_content: 'private-opaque' }));
  expect(body.input).toContainEqual(expect.objectContaining({ type: 'function_call', call_id: 'call_actual' }));
  expect(body.input).toContainEqual(expect.objectContaining({ type: 'function_call_output', call_id: 'call_actual' }));
  expect(JSON.stringify(body.input)).not.toMatch(/"id":"(?:rs|fc)_local"/);
  expect(requests[1].headers.get('chatgpt-account-id')).toBe('routing-only');
  expect(JSON.stringify(row)).toContain('private-opaque');
  expect(JSON.stringify(observations)).not.toContain('private-opaque');
  expect(formatRedactedJson(followup.context)).not.toContain('private-opaque');
  expect(JSON.stringify(observations)).toContain('call_actual');
  await second.close();
  const other = await fixture.runtime.openOperation({ context: { ...callContext, sessionKey: 'different-session' } });
  await other.generate({ request: followup });
  expect(JSON.stringify(await requests[2].json())).not.toContain('private-opaque');
  await other.close();
});

it('keeps an in-flight Profile on its captured model and follows an in-place model change only on the next operation without replaying old opaque state', async () => {
  const requests: Request[] = []; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fixture = driverFixture({ definition: codexProvider,
    model: { id: 'codex-local', kinds: ['language'], protocol: 'codex-responses', streaming: true }, parameters: { maxRetries: 0 },
    fetch: async (url, init) => { requests.push(new Request(url, init)); if (requests.length === 1) await gate; return codexReply(); } });
  const first = await fixture.runtime.openOperation({ context: callContext });
  const pending = first.generate({ request: { context: prompt } });
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  const graph = fixture.graph, nextModel = { ...graph.services.service.models['codex-local'], id: 'codex-next' };
  fixture.replaceGraph({ ...graph, revision: 2,
    services: { service: { ...graph.services.service, revision: 2, models: { ...graph.services.service.models, 'codex-next': nextModel } } },
    profiles: { selected: { ...graph.profiles.selected, revision: 2, model: 'codex-next' } } });
  release(); const prior = await pending;
  expect(prior.providerStateScope?.model).toBe('codex-local'); expect((await requests[0].json()).model).toBe('codex-local');
  await first.close();
  const next = await fixture.runtime.openOperation({ context: { ...callContext, operationId: 'next-turn' } });
  try {
    const result = await next.generate({ request: { context: { ...prompt, messages: [...prompt.messages, prior] } } });
    const wire = await requests[1].json();
    expect(wire.model).toBe('codex-next'); expect(JSON.stringify(wire.input)).not.toContain('private-opaque');
    expect(result.providerStateScope?.accountIncarnation).toBe(prior.providerStateScope?.accountIncarnation);
    expect(result.providerStateScope?.model).toBe('codex-next');
  } finally { await next.close(); fixture.runtime.retire(); }
});

it.each([{ temperature: 1 }, { maxOutputTokens: 20 }])('rejects explicit unsupported Codex parameters before any provider request', async parameters => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const fixture = driverFixture({ definition: codexProvider, model: { id: 'codex-local', kinds: ['language'], protocol: 'codex-responses' }, parameters, fetch });
  const client = await fixture.runtime.openOperation({ context: callContext });
  await expect(client.generate({ request: { context: prompt } })).rejects.toMatchObject({ code: 'unsupported-parameter' });
  expect(fetch).not.toHaveBeenCalled(); expect(fixture.authorize).not.toHaveBeenCalled(); await client.close();
});

it.each([openCodeGoProvider, openCodeZenProvider])('uses product-specific OpenCode inference endpoints and real Bearer authorization ($id)', async definition => {
  const requests: Request[] = [];
  const fixture = driverFixture({ definition, model: { id: 'selected', kinds: ['language'], protocol: 'openai-chat' }, parameters: { maxRetries: 0 },
    fetch: async (url, init) => { requests.push(new Request(url, init)); return chatReply(); } });
  const client = await fixture.runtime.openOperation({ context: callContext }); await client.generate({ request: { context: prompt } });
  expect(requests[0].url).toBe(`https://opencode.ai/inference${definition.id === 'opencode-go' ? '/go' : ''}/openai/v1/chat/completions`);
  expect(requests[0].headers.get('authorization')).toBe('Bearer synthetic-key');
  expect(requests[0].headers.get('x-opencode-session')).toMatch(/^[a-f0-9]{64}$/);
  expect(requests[0].headers.get('user-agent')).toMatch(/^zhin.js-ai\//); await client.close();
});

it('wraps real Google SDK Antigravity requests with the current account project and unwraps responses without losing usage', async () => {
  const requests: Request[] = [];
  const fixture = driverFixture({ definition: antigravityProvider, model: { id: 'gemini-local', kinds: ['language'], protocol: 'antigravity-generate-content' }, parameters: { maxRetries: 0 },
    grant: { token: 'synthetic-oauth', headers: {}, revision: '1', metadata: { projectId: 'account-project' } },
    fetch: async (url, init) => { requests.push(new Request(url, init)); return Response.json({ response: { candidates: [{ content: { role: 'model', parts: [{ text: 'hello' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6, cachedContentTokenCount: 4 } } }); },
  });
  const client = await fixture.runtime.openOperation({ context: callContext });
  const result = await client.generate({ request: { context: prompt } });
  expect(result.content).toEqual([{ type: 'text', text: 'hello' }]); expect(result.usage.cacheRead).toBe(4);
  expect(requests[0].url).toBe('https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent');
  expect(requests[0].headers.get('authorization')).toBe('Bearer synthetic-oauth');
  expect(requests[0].headers.has('x-goog-api-key')).toBe(false);
  expect(await requests[0].json()).toMatchObject({ project: 'account-project', model: 'gemini-local', request: { contents: expect.any(Array) } }); await client.close();
});

it('retains an exchanged Antigravity credential while independent read-only preparation fails and can be retried', async () => {
  const service = { id: 'service', rootId: 'root', ownerId: 'host:test', revision: 1, driver: { id: 'antigravity', owner: 'root/providers', contractVersion: '1' }, options: { baseUrl: 'https://daily-cloudcode-pa.googleapis.com' }, models: {} };
  const signal = new AbortController().signal, redirectUri = antigravityOAuth.redirectUri;
  const client = { clientSecret: 'synthetic-client-secret' };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' }));
  const challenge = await antigravityOAuth.begin({ service, signal, fetch, redirectUri, client });
  const credential = await antigravityOAuth.complete({ service, signal, fetch, redirectUri, client, challenge, code: 'code', state: challenge.state });
  expect(credential.preparation?.status).toBe('required'); expect(credential.accessToken).toBe('synthetic-access');
  fetch.mockResolvedValueOnce(Response.json({ error: 'not-ready' }, { status: 503 }));
  await expect(antigravityOAuth.prepare!({ service, signal, fetch, client, credential })).rejects.toMatchObject({ code: 'identity-unavailable' });
  expect(credential.preparation?.status).toBe('required');
  fetch.mockResolvedValueOnce(Response.json({ id: 'google-subject' })).mockResolvedValueOnce(Response.json({ cloudaicompanionProject: { id: 'actual-account-project' } }));
  const ready = await antigravityOAuth.prepare!({ service, signal, fetch, client, credential });
  expect(ready).toMatchObject({ subject: 'google-subject', metadata: { projectId: 'actual-account-project' }, preparation: { status: 'ready' } });
  expect(fetch.mock.calls.filter(([url]) => String(url).includes('/token'))).toHaveLength(1);
  expect(fetch.mock.calls.some(([url]) => String(url).includes('onboard'))).toBe(false);
});

it('parses split CRLF and UTF-8 Antigravity SSE and replays signed tool calls on the next request', async () => {
  const requests: Request[] = [];
  const observations: unknown[] = [];
  const chunks = [
    { response: { candidates: [{ content: { role: 'model', parts: [{ text: '你好' }] } }] } },
    { response: { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'lookup', args: { value: 1 } }, thoughtSignature: 'real-synthetic-signature' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } } },
  ];
  const fixture = driverFixture({ definition: antigravityProvider,
    model: { id: 'gemini-local', kinds: ['language'], protocol: 'antigravity-generate-content', streaming: true, toolCalling: true }, parameters: { maxRetries: 0 },
    grant: { token: 'synthetic', headers: {}, revision: '1', metadata: { projectId: 'project' } },
    fetch: async (url, init) => {
      requests.push(new Request(url, init));
      if (requests.length > 1) return Response.json({ response: { candidates: [{ content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: 'STOP' }] } });
      // One-byte transport chunks split both CRLF and every Chinese code point.
      const bytes = new TextEncoder().encode(chunks.map(value => `data: ${JSON.stringify(value)}`).join('\r\n\r\n'));
      let position = 0;
      return new Response(new ReadableStream({ pull(controller) {
        if (position === bytes.length) controller.close(); else controller.enqueue(bytes.slice(position, ++position));
      } }), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  const client = await fixture.runtime.openOperation({ context: callContext });
  const tools = [{ name: 'lookup', description: 'synthetic', parameters: z.object({ value: z.number() }) }];
  const run = await client.stream({ request: { context: { ...prompt, tools } } });
  let completed: import('../../src/llm/types/agent-message.js').AssistantMessage | undefined;
  for await (const event of run) if (event.type === 'done') completed = event.message;
  expect(completed?.content).toContainEqual({ type: 'text', text: '你好' });
  const call = completed?.content.find(block => block.type === 'toolCall');
  if (!completed || !call || call.type !== 'toolCall') throw new Error('expected signed tool');
  expect(call.providerOptions).toEqual({ google: { thoughtSignature: 'real-synthetic-signature' } });
  const row = serializeAgentMessage(completed), restored = parseAgentMessageRow(row);
  if (!restored || restored.role !== 'assistant') throw new Error('expected persisted assistant');
  await client.generate({ request: { context: { ...prompt, tools, messages: [...prompt.messages, restored,
    { role: 'toolResult', toolCallId: call.id, toolName: call.name, isError: false, timestamp: 2, content: [{ type: 'text', text: 'result' }] }] },
    options: { onRequest: value => { observations.push(value); } } } });
  expect(JSON.stringify(await requests[1].json())).toContain('real-synthetic-signature');
  expect(JSON.stringify(row)).toContain('real-synthetic-signature');
  expect(JSON.stringify(observations)).not.toContain('real-synthetic-signature');
  expect(formatRedactedJson(restored)).not.toContain('real-synthetic-signature');
  await client.close();
});

it('keeps Antigravity streaming pull-bound and aborts the submitted transport on consumer break', async () => {
  let pulls = 0, cancelled = 0, submitted = 0;
  let transportSignal: AbortSignal | undefined;
  const totalFrames = 1000;
  const fixture = driverFixture({ definition: antigravityProvider,
    model: { id: 'gemini-local', kinds: ['language'], protocol: 'antigravity-generate-content', streaming: true }, parameters: { maxRetries: 0 },
    grant: { token: 'synthetic', headers: {}, revision: '1', metadata: { projectId: 'project' } }, fetch: async (_url, init) => {
      submitted++; transportSignal = new Request(_url, init).signal;
      let abort: (() => void) | undefined;
      return new Response(new ReadableStream({ start(controller) {
        // Native fetch aborts the response body when its request signal is aborted.
        // This synthetic fetch must implement that transport contract explicitly.
        abort = () => { cancelled++; controller.error(transportSignal?.reason); };
        transportSignal?.addEventListener('abort', abort, { once: true });
      }, pull(controller) {
        if (pulls === totalFrames) { controller.close(); return; }
        pulls++;
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: { candidates: [{ content: { role: 'model', parts: [{ text: `frame-${pulls}` }] } }] } })}\r\n\r\n`));
      }, cancel() { if (abort) transportSignal?.removeEventListener('abort', abort); cancelled++; } }), { headers: { 'content-type': 'text/event-stream' } });
    } });
  const client = await fixture.runtime.openOperation({ context: callContext });
  const run = await client.stream({ request: { context: prompt } });
  expect(submitted).toBe(0);
  for await (const event of run) if (event.type === 'text_delta') break;
  await vi.waitFor(() => expect(cancelled).toBe(1));
  expect(submitted).toBe(1); expect(pulls).toBeLessThan(totalFrames); expect(transportSignal?.aborted).toBe(true);
  await run.close(); await client.close(); expect(cancelled).toBe(1);
});

it('preserves Claude OAuth signed thinking/tool history through the installed Anthropic SDK', async () => {
  const requests: Request[] = [];
  const observations: unknown[] = [];
  const fixture = driverFixture({ definition: claudeSubscriptionProvider,
    model: { id: 'claude-local', kinds: ['language'], protocol: 'anthropic-messages', toolCalling: true }, parameters: { maxRetries: 0 },
    grant: { token: 'synthetic-oauth', headers: {}, revision: '1' },
    fetch: async (url, init) => {
      requests.push(new Request(url, init));
      return Response.json({ id: 'msg_local', type: 'message', role: 'assistant', model: 'claude-local',
        content: requests.length === 1 ? [
          { type: 'thinking', thinking: 'considered', signature: 'actual-synthetic-signature' },
          { type: 'tool_use', id: 'toolu_local', name: 'lookup', input: { value: 1 } },
        ] : [{ type: 'text', text: 'done' }],
        stop_reason: requests.length === 1 ? 'tool_use' : 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 },
      });
    },
  });
  const client = await fixture.runtime.openOperation({ context: callContext });
  const tools = [{ name: 'lookup', description: 'synthetic', parameters: z.object({ value: z.number() }) }];
  const initial = await client.generate({ request: { context: { ...prompt, tools } } });
  expect(initial.usage).toMatchObject({ cacheRead: 5, cacheWrite: 2 });
  const row = serializeAgentMessage(initial), restored = parseAgentMessageRow(row);
  if (!restored || restored.role !== 'assistant') throw new Error('expected persisted assistant');
  await client.generate({ request: { context: { ...prompt, tools, messages: [...prompt.messages, restored,
    { role: 'toolResult', toolCallId: 'toolu_local', toolName: 'lookup', isError: false, timestamp: 2, content: [{ type: 'text', text: 'result' }] }] }, options: { onRequest: value => { observations.push(value); } } } });
  expect(requests.every(request => request.headers.get('authorization') === 'Bearer synthetic-oauth' && !request.headers.has('x-api-key'))).toBe(true);
  const history = JSON.stringify(await requests[1].json());
  expect(history).toContain('actual-synthetic-signature'); expect(history).toContain('toolu_local');
  expect(history).not.toMatch(/Claude Code|You are Claude/);
  expect(JSON.stringify(row)).toContain('actual-synthetic-signature');
  expect(JSON.stringify(observations)).not.toContain('actual-synthetic-signature');
  expect(formatRedactedJson(restored)).not.toContain('actual-synthetic-signature');
  expect(JSON.stringify(observations)).toContain('toolu_local');
  await client.close();
});

it.each([
  { protocol: 'anthropic-messages', suffix: '/anthropic/v1/messages', response: () => Response.json({ id: 'msg_local', type: 'message', role: 'assistant', model: 'selected', content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 3, output_tokens: 1 } }) },
  { protocol: 'google-generate-content', suffix: '/google/v1beta/models/selected:generateContent', response: () => Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: 'hello' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 } }) },
  { protocol: 'openai-responses', suffix: '/openai/v1/responses', response: () => Response.json({ id: 'resp_local', created_at: 1, model: 'selected', object: 'response', status: 'completed', output: [{ type: 'message', id: 'msg_local', role: 'assistant', content: [{ type: 'output_text', text: 'hello', annotations: [] }] }], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 } }) },
])('uses Bearer for OpenCode $protocol without native SDK authentication leakage', async ({ protocol, suffix, response }) => {
  const requests: Request[] = [];
  const fixture = driverFixture({ definition: openCodeGoProvider, model: { id: 'selected', kinds: ['language'], protocol }, parameters: { maxRetries: 0 },
    fetch: async (url, init) => { requests.push(new Request(url, init)); return response(); } });
  const client = await fixture.runtime.openOperation({ context: callContext });
  expect((await client.generate({ request: { context: prompt } })).content).toEqual([{ type: 'text', text: 'hello' }]);
  expect(requests[0].url).toBe(`https://opencode.ai/inference/go${suffix}`);
  expect(requests[0].headers.get('authorization')).toBe('Bearer synthetic-key');
  expect(requests[0].headers.has('x-api-key')).toBe(false); expect(requests[0].headers.has('x-goog-api-key')).toBe(false);
  await client.close();
});


it.each([{ promptCacheKey: 'caller-route' }, { promptCacheRetention: '24h' as const }])('rejects explicit generic Codex cache policy %j rather than silently replacing it', async options => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const fixture = driverFixture({ definition: codexProvider, model: { id: 'codex-local', kinds: ['language'], protocol: 'codex-responses' }, parameters: { maxRetries: 0 }, fetch });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try { await expect(client.generate({ request: { context: prompt, options } })).rejects.toMatchObject({ code: 'unsupported-parameter' });
    expect(fetch).not.toHaveBeenCalled(); expect(fixture.authorize).not.toHaveBeenCalled(); } finally { await client.close(); }
});
