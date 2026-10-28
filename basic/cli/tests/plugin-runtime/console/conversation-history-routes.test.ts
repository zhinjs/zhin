import { createHttpHost, type HttpHost } from '@zhin.js/host-http';
import { CONVERSATION_EVENT_MODEL, CONVERSATION_CURSOR_MODEL, DatabaseConversationEventStore, type ConversationEvent, type ConversationEventReader, type ConversationRef, type Segment } from '@zhin.js/im-contract';
import type { StructuredDatabase } from '@zhin.js/database';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { migrateConversationColumns } from '../../../src/plugin-runtime/conversation-migration.js';
import { registerConversationHistoryRoutes } from '../../../src/plugin-runtime/console/conversation-history-routes.js';

type HistoryIm = NonNullable<Parameters<typeof registerConversationHistoryRoutes>[0]['im']>;
const conversation: ConversationRef = {
  endpoint: { adapter: 'slack', id: 'root/slack\0adapter\0bot' }, kind: 'channel', id: 'room:with:colons',
  parent: { kind: 'channel', id: 'workspace' }, threadId: 'topic',
};
const sessionKey = 'slack:main:channel:room:with:colons';
let directory: string;
let database: ReturnType<typeof createDatabaseHost>;
let events: DatabaseConversationEventStore;
const hosts: HttpHost[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'zhin-chat-history-'));
  database = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'history.sqlite') });
  database.define('conversation_events', CONVERSATION_EVENT_MODEL);
  database.define('conversation_event_cursors', CONVERSATION_CURSOR_MODEL);
  await database.start();
  await migrateConversationColumns(database.getRawDatabase() as StructuredDatabase);
  events = new DatabaseConversationEventStore(database.models.get('conversation_events')!, database.models.get('conversation_event_cursors')!);
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  await database.stop();
  await rm(directory, { recursive: true, force: true });
});

function message(id: string, scene = conversation, segments: readonly Segment[] = [{ type: 'text', data: { text: id } }], outgoing = false): ConversationEvent {
  return { type: 'message.created', eventId: id, conversation: scene, timestamp: 7,
    message: { ref: { conversation: scene, id }, timestamp: 7, segments, ...(outgoing ? {} : { actor: { id: 'alice', displayName: 'Alice' } }) } };
}

function runtime(reader: ConversationEventReader = events): HistoryIm {
  return {
    endpoints: { get: (adapter: string, endpointKey: string) => adapter === 'slack' && endpointKey === 'main' ? { endpoint: conversation.endpoint } : null },
    conversationEventReader: reader,
    runWithSnapshotView: async (operation: () => Promise<unknown>) => operation(),
  } as unknown as HistoryIm;
}

async function start(im: HistoryIm | undefined = runtime(), available = true) {
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator', tokens: [{ token: 'demo', scope: 'demo' }] });
  hosts.push(http);
  registerConversationHistoryRoutes({ http, base: '/api', im, databaseHost: available ? database : undefined });
  const { port } = await http.listen();
  return (params: Record<string, string> = { sessionKey }, token = 'operator') => fetch(`http://127.0.0.1:${port}/api/conversations/history?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${token}` } });
}

it('reads full canonical inbound and sent bot text without requiring an Agent session or Inbox preview', async () => {
  const text = '    first line\n' + '完整正文'.repeat(120) + '\n\n';
  await events.append(message('inbound', conversation, [{ type: 'text', data: { text } }]));
  await events.append(message('outbound', conversation, [{ type: 'text', data: { text: 'Bot answer' } }], true));
  const request = await start();
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const { data } = await response.json();
  expect(data.conversation).toEqual(conversation);
  expect(data.items.map((item: any) => item.message.segments[0].data.text)).toEqual([text, 'Bot answer']);
  expect(data.items[0].message.actor).toEqual({ id: 'alice', displayName: 'Alice' });
  expect(data.items[1].message).not.toHaveProperty('actor');
  expect(data).toMatchObject({ hasMore: false, nextBeforeSequence: null });
});

it('paginates fifty actual events, including skipped scene events, with a stable exclusive sequence cursor', async () => {
  for (let index = 1; index <= 56; index++) {
    await events.append(index === 7 ? { type: 'member.joined', eventId: 'joined', conversation, timestamp: 7, member: { id: 'member' } } : message(`message-${index}`));
  }
  const read = vi.spyOn(events, 'listBetween');
  const request = await start();
  const first = (await (await request()).json()).data;
  expect(first.items).toHaveLength(50);
  expect(first.items.map((item: any) => item.sequence)).toEqual(Array.from({ length: 50 }, (_, index) => index + 7));
  expect(first.items[0]).toEqual({ sequence: 7, type: 'member.joined', timestamp: 7 });
  expect(first).toMatchObject({ hasMore: true, nextBeforeSequence: 7 });
  expect(read).toHaveBeenLastCalledWith(conversation, 0, 56, 51);
  await events.append(message('arrived-later'));
  const second = (await (await request({ sessionKey, beforeSequence: String(first.nextBeforeSequence) })).json()).data;
  expect(second.items.map((item: any) => item.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(second).toMatchObject({ hasMore: false, nextBeforeSequence: null });
  expect(read).toHaveBeenLastCalledWith(conversation, 0, 6, 51);
});

it('clamps even a large valid cursor to the latest stored sequence rather than passing an int4-overflow sentinel to the reader', async () => {
  await events.append(message('first'));
  await events.append(message('latest'));
  const listBetween = events.listBetween.bind(events);
  const read = vi.spyOn(events, 'listBetween').mockImplementationOnce(async (...args) => {
    await events.append(message('arrived-during-read'));
    return listBetween(...args);
  });
  const request = await start();
  const response = await request({ sessionKey, beforeSequence: '9007199254740991' });
  expect(response.status).toBe(200);
  expect((await response.json()).data.items.map((item: any) => item.message.ref.id)).toEqual(['first', 'latest']);
  expect(read).toHaveBeenCalledExactlyOnceWith(conversation, 0, 2, 51);
});

it.each([
  { ...conversation, threadId: 'another-topic' },
  { ...conversation, threadId: undefined },
  { ...conversation, parent: { kind: 'channel' as const, id: 'other-workspace' } },
  { ...conversation, parent: undefined },
])('refuses ambiguity instead of silently dropping a parent or thread: %j', async second => {
  await events.append(message('first'));
  await events.append(message('second', second));
  const read = vi.spyOn(events, 'listBetween');
  const request = await start();
  const response = await request();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'conversation_ambiguous' });
  expect(read).not.toHaveBeenCalled();
});

it('does not mix another Endpoint, channel kind, or conversation sharing the same native message id', async () => {
  await events.append(message('selected'));
  await events.append(message('other-bot', { ...conversation, endpoint: { ...conversation.endpoint, id: 'different-bot' } }));
  await events.append(message('other-room', { ...conversation, id: 'other-room' }));
  await events.append(message('other-kind', { ...conversation, kind: 'group' }));
  const request = await start();
  const { data } = await (await request()).json();
  expect(data.items.map((item: any) => item.message.ref.id)).toEqual(['selected']);
});

it('preserves recall references and projects safe media and descriptions without private bytes, paths, or platform credentials', async () => {
  const sceneWithPlatformExtras = { ...conversation, raw: 'SECRET', endpoint: { ...conversation.endpoint, credential: 'SECRET' } };
  await events.append(message('media', sceneWithPlatformExtras, [
    { type: 'image', data: { media: { kind: 'url', value: 'https://assets.example/image.png' }, alt: 'public picture' }, platform: { token: 'SECRET' } },
    { type: 'image', data: { media: { kind: 'path', value: '/PRIVATE/image.png' }, alt: 'local picture' } },
    { type: 'file', data: { media: { kind: 'base64', value: 'PRIVATE_BYTES' }, name: 'report' } },
    { type: 'audio', data: { media: { kind: 'file', value: 'platform-file-id' } } },
    { type: 'image', data: { media: { kind: 'url', value: 'https://user:PASSWORD@example.com/image' } } },
    { type: 'face', data: { id: 1, name: 'Smile', raw: 'SECRET' } },
    { type: 'reply', data: { message_id: 'quoted', raw: 'SECRET' } },
    { type: 'markdown', data: { content: '**full markdown**', raw: 'SECRET' } },
    { type: 'forward', data: { forward_id: 'forward', title: 'Conversation', entries: [{ segments: [
      { type: 'text', data: { text: 'Forwarded text' } }, { type: 'image', data: { media: { kind: 'base64', value: 'PRIVATE_BYTES' } } },
    ] }] } },
    { type: 'unknown', data: { path: '/PRIVATE/file', token: 'SECRET' }, platform: { token: 'SECRET' } },
  ]));
  await events.append({ type: 'message.recalled', eventId: 'recalled', conversation: sceneWithPlatformExtras, timestamp: 8, message: { conversation: sceneWithPlatformExtras, id: 'media' } });
  const request = await start();
  const body = await (await request()).json();
  expect(body.data.items[0].message.segments).toEqual([
    { type: 'image', data: { media: { kind: 'url', value: 'https://assets.example/image.png' }, alt: 'public picture' } },
    { type: 'image', data: { alt: 'local picture' } }, { type: 'file', data: { name: 'report' } },
    { type: 'audio', data: {} }, { type: 'image', data: {} },
    { type: 'face', data: { id: 1, name: 'Smile' } }, { type: 'reply', data: { message_id: 'quoted' } },
    { type: 'markdown', data: { content: '**full markdown**' } },
    { type: 'forward', data: { forward_id: 'forward', title: 'Conversation', entries: [{ segments: [
      { type: 'text', data: { text: 'Forwarded text' } }, { type: 'image', data: {} },
    ] }] } }, { type: 'unknown', data: {} },
  ]);
  expect(body.data.items[1].messageRef).toEqual({ conversation, id: 'media' });
  expect(body.data.conversation).toEqual(conversation);
  expect(JSON.stringify(body)).not.toMatch(/SECRET|PRIVATE|PASSWORD|platform-file-id/u);
});

it.each([{ sessionKey: '' }, { sessionKey: 'slack:main:invalid:room' }, { sessionKey, beforeSequence: '' }, { sessionKey, beforeSequence: '0' }, { sessionKey, beforeSequence: '1.5' }, { sessionKey, beforeSequence: '9007199254740992' }])('validates identities and sequence cursors before reading %j', async params => {
  const read = vi.spyOn(events, 'listBetween');
  const request = await start();
  expect((await request(params)).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});

it('distinguishes missing records, unavailable addresses, and unavailable persistence', async () => {
  const request = await start();
  expect((await request()).status).toBe(404);
  expect((await request({ sessionKey: 'slack:removed:channel:room' })).status).toBe(503);
  const unavailable = await start(runtime(), false);
  expect((await unavailable()).status).toBe(503);
});

it('never touches message storage for demo or invalid credentials', async () => {
  const read = vi.spyOn(events, 'listBetween');
  const request = await start();
  expect((await request({ sessionKey }, 'demo')).status).toBe(403);
  expect((await request({ sessionKey }, 'wrong')).status).toBe(401);
  expect(read).not.toHaveBeenCalled();
});

it('keeps the snapshot operation open through asynchronous reads and releases it on success and failure', async () => {
  await events.append(message('held'));
  let active = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const listBetween = vi.fn(async (...args: Parameters<ConversationEventReader['listBetween']>) => {
    expect(active).toBe(1);
    await pending;
    expect(active).toBe(1);
    return events.listBetween(...args);
  });
  const im = runtime({ ...events, listBetween } as ConversationEventReader);
  im.runWithSnapshotView = async operation => { active++; try { return await operation(); } finally { active--; } };
  const request = await start(im);
  const response = request();
  await vi.waitFor(() => expect(listBetween).toHaveBeenCalledOnce());
  expect(active).toBe(1);
  release();
  expect((await response).status).toBe(200);
  expect(active).toBe(0);
  listBetween.mockRejectedValueOnce(new Error('PRIVATE database failure'));
  const failed = await request();
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('PRIVATE');
  expect(active).toBe(0);
});
