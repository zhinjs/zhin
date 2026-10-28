import { createHttpHost, type HttpHost } from '@zhin.js/host-http';
import { createTurnTraceArchive, type TurnTrace } from '@zhin.js/agent/trace';
import type { ConversationRef } from '@zhin.js/im-contract';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTraceArchiveRoutes } from '../../../src/plugin-runtime/console/trace-archive-routes.js';

const conversation: ConversationRef = { endpoint: { adapter: 'slack', id: 'root/slack\0adapter\0bot' }, kind: 'channel', id: 'room:with:colons', parent: { kind: 'channel', id: 'workspace' }, threadId: 'topic' };
const sessionKey = 'slack:main:channel:room:with:colons';
let directory: string;
const hosts: HttpHost[] = [];
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'zhin-trace-api-')); });
afterEach(async () => { for (const host of hosts.splice(0)) await host.close(); await rm(directory, { recursive: true, force: true }); });

function trace(turnId = 'root-turn', extra: Partial<TurnTrace> = {}): TurnTrace {
  return { version: 1, turn_id: turnId, session_key: sessionKey, started_at: Date.now(), duration_ms: 5,
    origin: { kind: 'im', platform: 'slack', endpoint: 'main', scope: 'channel', sceneId: conversation.id, conversation, messageId: 'inbound-message' },
    model_calls: [{ request_id: `${turnId}/request`, index: 1, prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, reported: { input: true, output: true, totalTokens: true } }],
    requests: [{ request_id: `${turnId}/request`, index: 1, provider: 'fixture', model: 'fixture', started_at: Date.now(), status: 'completed', body_status: 'recorded', body: { system: `prompt of ${turnId}`, messages: [{ role: 'user', content: '  exact text\n\n' }], tools: [] } }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }, tool_calls: [], budget: { extensions: [], continuations: 0 },
    subagent_tasks: [], subagents: [], timeline: [], termination: { status: 'completed' }, dropped: 0, ...extra };
}
async function start(rows: TurnTrace[] = [trace()]) {
  const archive = createTurnTraceArchive(directory, { secrets: [] });
  for (const row of rows) await archive.save(row);
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator', tokens: [{ token: 'demo', scope: 'demo' }] });
  hosts.push(http);
  registerTraceArchiveRoutes({ http, base: '/api', projectRoot: directory, dir: directory });
  const { port } = await http.listen();
  return (route: string, params: Record<string, string> = {}, token = 'operator') => fetch(`http://127.0.0.1:${port}/api/agent/trace-archive/${route}?${new URLSearchParams({ sessionKey, conversation: JSON.stringify(conversation), ...params })}`, { headers: { authorization: `Bearer ${token}` } });
}

it('requires full scope and marks archive responses and validation errors no-store', async () => {
  const request = await start();
  for (const route of ['sessions', 'turns', 'turn', 'request']) {
    const denied = await request(route, {}, 'demo');
    expect(denied.status).toBe(403);
  }
  const invalid = await request('request');
  expect(invalid.status).toBe(400);
  expect(invalid.headers.get('cache-control')).toBe('no-store');
  const valid = await request('turns');
  expect(valid.status).toBe(200);
  expect(valid.headers.get('cache-control')).toBe('no-store');
});

it('lists recursive reported usage exactly once without returning any request bodies', async () => {
  const request = await start([trace('root-turn', { subagents: [trace('child-turn', { origin: undefined })] })]);
  const { data } = await (await request('turns')).json();
  expect(data).toHaveLength(1);
  expect(data[0].origin.conversation).toEqual(conversation);
  expect(data[0].usage_calls.map((call: { request_id: string }) => call.request_id)).toEqual(['root-turn/request', 'child-turn/request']);
  expect(data[0].request_count).toBe(2);
  expect(JSON.stringify(data)).not.toContain('prompt of');
  const detail = (await (await request('turn', { turnId: 'root-turn' })).json()).data;
  expect(detail.requests[0]).toMatchObject({ request_id: 'root-turn/request', body_status: 'recorded' });
  expect(detail.requests[0]).not.toHaveProperty('body');
  expect(detail.subagents[0].requests[0]).not.toHaveProperty('body');
});

it('loads one exact child request by root turn with its own exact usage', async () => {
  const request = await start([trace('root-turn', { subagents: [trace('child-turn', { origin: undefined })] })]);
  const response = await request('request', { turnId: 'root-turn', requestId: 'child-turn/request' });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ session_key: sessionKey, turn_id: 'root-turn', request_turn_id: 'child-turn', request: { body: { system: 'prompt of child-turn' } }, usage: { request_id: 'child-turn/request', total_tokens: 12 } });
  expect((await request('request', { turnId: 'child-turn', requestId: 'child-turn/request' })).status).toBe(404);
});

it.each([
  { sessionKey: 'other-session' }, { turnId: 'root' }, { requestId: 'root-turn' },
  { conversation: JSON.stringify({ ...conversation, threadId: 'other-topic' }) },
  { conversation: JSON.stringify({ ...conversation, parent: undefined }) },
  { conversation: JSON.stringify({ ...conversation, endpoint: { ...conversation.endpoint, id: 'other-bot' } }) },
])('rejects mismatched sessions, prefix identities and different canonical addresses: %j', async mismatch => {
  const request = await start();
  const response = await request('request', { turnId: 'root-turn', requestId: 'root-turn/request', ...mismatch });
  expect(response.status).toBe(404);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('does not attach old records without canonical origins to a physical conversation', async () => {
  const request = await start([trace('old', { origin: undefined, requests: undefined }), trace('other-topic', { origin: { ...trace().origin!, kind: 'im', platform: 'slack', endpoint: 'main', scope: 'channel', sceneId: conversation.id, conversation: { ...conversation, threadId: 'different' } } })]);
  expect((await (await request('turns')).json()).data).toEqual([]);
  expect((await request('turn', { turnId: 'old' })).status).toBe(404);
});

it.each(['disabled', 'unsupported', 'too_large', 'capture_failed'] as const)('returns an unavailable body reason without inventing a prompt or provider usage: %s', async body_status => {
  const request = await start([trace('root-turn', { model_calls: [], requests: [{ request_id: 'r', index: 1, provider: 'p', model: 'm', started_at: Date.now(), status: 'failed', body_status }] })]);
  const { data } = await (await request('request', { turnId: 'root-turn', requestId: 'r' })).json();
  expect(data.request).toMatchObject({ body_status, status: 'failed' });
  expect(data.request).not.toHaveProperty('body');
  expect(data).not.toHaveProperty('usage');
});
