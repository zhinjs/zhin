import { captureRequestBody, RequestBodyTooLargeError } from '../../src/trace/request-trace.js';
import { TurnTraceCollector } from '../../src/trace/turn-trace.js';

const body = (text = 'exact input') => ({ system: { role: 'system', content: text, providerOptions: { token: 'PRIVATE' } }, messages: [{ role: 'user', content: text }], tools: [] });
const request = (id: string, text = 'exact input') => ({ request_id: id, provider: 'fixture', model: 'fixture', started_at: 10, status: 'running' as const, body_status: 'recorded' as const, body: body(text) });

it('captures SDK system objects and arrays, complete text and tool definitions without mutating input', () => {
  const text = '  start\n' + '完整正文'.repeat(200) + '\n\nend  ';
  const input = { ...body(text), system: [body().system, { role: 'system', content: 'second block' }], tools: [{ name: 'inspect', description: 'Inspect a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }] };
  const captured = captureRequestBody(input, []);
  expect(captured.body.system).toBe('exact input\n\nsecond block');
  expect(captured.body.messages[0]?.content).toBe(text);
  expect(captured.body.tools[0]?.input_schema).toEqual(input.tools[0]?.inputSchema);
  expect(input.system[0]).toHaveProperty('providerOptions.token', 'PRIVATE');
  expect(Object.isFrozen(captured.body.messages[0])).toBe(true);
  expect(captured.bytes).toBeGreaterThanOrEqual(Buffer.byteLength(JSON.stringify(captured.body)));
});

it('redacts credentials without treating schema property names or ordinary base64-looking text as secrets', () => {
  const secret = 'a-long-runtime-secret-value';
  const captured = captureRequestBody({
    system: `api_key=sk-1234567890123456 Bearer abcdefghijklmnop ${secret}`,
    messages: [{ role: 'tool', content: { password: 'do-not-save', value: 'a'.repeat(100), private_key: 'PRIVATE', nested: { authorization: 'anything' } } }],
    tools: [{ name: 'login', inputSchema: { type: 'object', properties: { password: { type: 'string', description: 'Your password', default: 'do-not-save' }, token: { type: 'string' } } } }],
  }, [secret]);
  const raw = JSON.stringify(captured.body);
  for (const value of [secret, 'sk-1234567890123456', 'abcdefghijklmnop', 'do-not-save', 'PRIVATE', 'anything']) expect(raw).not.toContain(value);
  expect(raw).toContain('a'.repeat(100));
  expect(captured.body.tools[0]?.input_schema).toMatchObject({ properties: { password: { type: 'string', description: 'Your password', default: '[redacted]' }, token: { type: 'string' } } });
});

it('omits media bytes in parts, nested MCP results, binary values and inline wrappers', () => {
  const captured = captureRequestBody({ messages: [{ role: 'tool', content: [
    { type: 'image', image: 'IMAGE_BYTES' },
    { type: 'file', data: 'FILE_BYTES', mediaType: 'image/png' },
    { type: 'tool-result', output: { content: [{ type: 'image', data: 'MCP_BYTES', mimeType: 'image/png' }] } },
    { type: 'text', text: 'image=data:image/png;base64,YWJjZGVm audio=base64://YWJjZGVm' },
    { data: Buffer.from('BINARY_BYTES'), bytes: 'RAW_BYTES', base64: 'RAW_BASE64' },
  ] }] }, []);
  const raw = JSON.stringify(captured.body);
  for (const value of ['IMAGE_BYTES', 'FILE_BYTES', 'MCP_BYTES', 'YWJjZGVm', 'BINARY_BYTES', 'RAW_BYTES', 'RAW_BASE64']) expect(raw).not.toContain(value);
  expect(raw).toContain('media omitted');
});

it('estimates original text rather than redacted text, and excludes media from the text estimate', () => {
  const secret = 'credential-material'.repeat(100);
  const plain = captureRequestBody(body(secret), []);
  const redacted = captureRequestBody(body(secret), [secret]);
  expect(redacted.estimated_tokens).toEqual(plain.estimated_tokens);
  expect(redacted.estimated_tokens.basis).toBe('model_input_text');
  const image = (data: string) => captureRequestBody({ messages: [{ role: 'user', content: [{ type: 'image', image: data }] }] }, []);
  expect(image('x'.repeat(50000)).estimated_tokens).toEqual(image('x').estimated_tokens);
});

it('bounds a captured body before retaining it and preserves the estimate on overflow', () => {
  const input = body('large input '.repeat(1000));
  try {
    captureRequestBody(input, [], 100);
    throw new Error('expected a bounded capture');
  } catch (error) {
    expect(error).toBeInstanceOf(RequestBodyTooLargeError);
    expect((error as RequestBodyTooLargeError).estimatedTokens.total).toBeGreaterThan(100);
  }
});

it('keeps a stable request index through repeated SDK observations and exact usage association', () => {
  const value = request('request-1');
  const capacity = captureRequestBody(value.body, []).bytes;
  const collector = new TurnTraceCollector({ turnId: 'turn', sessionKey: 'session', maxRequestBytes: capacity });
  collector.note({ kind: 'model_request', request: value });
  collector.note({ kind: 'model_request', request: value });
  collector.note({ kind: 'model_request_end', request_id: value.request_id, status: 'completed', duration_ms: 8 });
  collector.record({ type: 'usage', requestId: value.request_id, usage: { promptTokens: 9, completionTokens: 2, totalTokens: 11 } });
  expect(collector.snapshot().requests).toHaveLength(1);
  expect(collector.snapshot().requests?.[0]).toMatchObject({ index: 1, body_status: 'recorded', status: 'completed', duration_ms: 8 });
  expect(collector.snapshot().model_calls[0]?.request_id).toBe(value.request_id);
});

it('shares the body limit with child turns, preserves overflow statistics and releases replaced bodies', () => {
  const value = request('parent');
  const capacity = captureRequestBody(value.body, []).bytes;
  const collector = new TurnTraceCollector({ turnId: 'turn', sessionKey: 'session', maxRequestBytes: capacity });
  collector.note({ kind: 'model_request', request: value });
  const child = collector.child('child');
  child.note({ kind: 'model_request', request: request('child') });
  expect(child.snapshot().requests?.[0]).toMatchObject({ body_status: 'too_large', estimated_tokens: { basis: 'model_input_text' } });
  expect(child.snapshot().requests?.[0]).not.toHaveProperty('body', expect.anything());
  collector.note({ kind: 'model_request', request: request('parent', 'x'.repeat(10000)) });
  expect(collector.snapshot().requests?.[0]?.body_status).toBe('too_large');
  child.note({ kind: 'model_request', request: request('child') });
  expect(child.snapshot().requests?.[0]?.body_status).toBe('recorded');
});

it('records failed requests without inventing usage and does not turn old trace stats into prompts', () => {
  const collector = new TurnTraceCollector({ turnId: 'turn', sessionKey: 'session' });
  expect(collector.snapshot().requests).toBeUndefined();
  collector.note({ kind: 'model_request', request: request('failed') });
  collector.note({ kind: 'model_request_end', request_id: 'failed', status: 'failed', duration_ms: 2 });
  expect(collector.snapshot().requests?.[0]?.status).toBe('failed');
  expect(collector.snapshot().model_calls).toEqual([]);
});


it('redacts complete cookie values, quoted credentials with spaces and URL userinfo in tool text', () => {
  const text = [
    'Cookie: sid=fixture-session-secret; csrf=fixture-csrf-secret',
    'Set-Cookie: sid=fixture-set-secret; SameSite=Lax',
    '{"password":"fixture two word password","token":"fixture two word token","headers":{"Cookie":"sid=fixture-json-secret; csrf=fixture-json-csrf"},"text":"ordinary text"}',
    'https://fixture-user:fixture-pass@example.invalid/path',
  ].join('\n');
  const stored = JSON.stringify(captureRequestBody({ messages: [{ role: 'tool', content: text }] }, []).body);
  for (const secret of ['fixture-session-secret', 'fixture-csrf-secret', 'fixture-set-secret', 'two word password', 'two word token', 'fixture-json-secret', 'fixture-json-csrf', 'fixture-user', 'fixture-pass']) expect(stored).not.toContain(secret);
  expect(stored).toContain('ordinary text');
  expect(stored).toContain('example.invalid/path');
});


it('omits typed image data inside JSON-stringified tool results while preserving ordinary JSON text', () => {
  const value = JSON.stringify({ content: [{ type: 'image', mimeType: 'image/png', data: 'PRIVATE_MCP_BYTES' }, { type: 'text', text: 'description' }], count: 2 });
  const captured = captureRequestBody({ messages: [{ role: 'tool', content: value }] }, []);
  expect(JSON.stringify(captured.body)).not.toContain('PRIVATE_MCP_BYTES');
  expect(JSON.stringify(captured.body)).toContain('description');
  const ordinary = '  { "value": "aaaaaaaaaaaaaaaaaaaaaaa" }  ';
  expect(captureRequestBody({ messages: [{ role: 'tool', content: ordinary }] }, []).body.messages[0]?.content).toBe(ordinary);
});


it('clears captured content and releases capacity if a later observation of that request fails', () => {
  const value = request('first');
  const collector = new TurnTraceCollector({ turnId: 'turn', sessionKey: 's', maxRequestBytes: captureRequestBody(value.body, []).bytes });
  collector.note({ kind: 'model_request', request: value });
  const { body: _body, ...metadata } = value;
  collector.note({ kind: 'model_request', request: { ...metadata, body_status: 'capture_failed' } });
  expect(collector.snapshot().requests?.[0]?.body).toBeUndefined();
  collector.note({ kind: 'model_request', request: request('second') });
  expect(collector.snapshot().requests?.[1]?.body_status).toBe('recorded');
});


it('does not spend the retained tree budget on a child dropped by the existing child limit', () => {
  const value = request('root');
  const collector = new TurnTraceCollector({ turnId: 'turn', sessionKey: 's', maxRequestBytes: captureRequestBody(value.body, []).bytes });
  for (let index = 0; index < 20; index++) collector.child(`child-${index}`);
  collector.child('discarded').note({ kind: 'model_request', request: request('invisible') });
  collector.note({ kind: 'model_request', request: value });
  expect(collector.snapshot().subagents).toHaveLength(20);
  expect(collector.snapshot().requests?.[0]?.body_status).toBe('recorded');
});
