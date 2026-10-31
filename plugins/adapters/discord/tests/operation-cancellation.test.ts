import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AttachmentBuilder } from 'discord.js';
import { toMessageCreateOptions } from '../src/gateway.js';
import { createHttpHost } from '@zhin.js/host-http';
import { adapterFeatureId } from 'zhin.js/adapter';
import { capabilityId, rootPluginId } from 'zhin.js';
import { discordFixture } from './fixture.js';
import { DiscordGatewayEndpoint, DiscordInteractionsEndpoint } from '../src/endpoint.js';
import { resolveDiscordConfig } from '../src/protocol.js';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const identity = capabilityId(rootPluginId(), adapterFeatureId, 'discord');
async function gatewayFixture(methods: object) {
  const config = resolveDiscordConfig({ id: 'synthetic', token: 'synthetic', connection: 'gateway' });
  if (config.connection !== 'gateway') throw new Error('Expected Gateway configuration');
  const f = await discordFixture(() => new DiscordGatewayEndpoint({ id: identity, config }), () => ({ login: async () => undefined, ...methods }));
  await f.start(); f.open();
  const conversation = { endpoint: { adapter: 'discord', id: f.canonicalId }, kind: 'channel' as const, id: 'channel' };
  return { ...f, conversation };
}
it('cancels a pending Gateway channel lookup before a native send can be submitted', async () => {
  const lookup = deferred<{ isSendable(): boolean; send: ReturnType<typeof vi.fn> }>(), send = vi.fn(async () => ({ id: 'late' }));
  const fetch = vi.fn(() => lookup.promise), f = await gatewayFixture({ channels: { fetch } }), caller = new AbortController();
  let outcome: unknown;
  const sending = f.send({ conversation: f.conversation, payload: 'hello', signal: caller.signal }).then(value => { outcome = { value }; }, error => { outcome = { error }; });
  try {
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); caller.abort();
    await vi.waitFor(() => expect(outcome).toMatchObject({ error: { disposition: 'not_sent' } }), { timeout: 200 });
    lookup.resolve({ isSendable: () => true, send }); await sending; await new Promise(resolve => setImmediate(resolve));
    expect(send).not.toHaveBeenCalled();
  } finally { lookup.resolve({ isSendable: () => true, send }); await sending; await f.stop(); }
});
it.each(['recall', 'reaction'] as const)('cancels Gateway %s preparation without a late native effect', async operation => {
  const lookup = deferred<{ delete: ReturnType<typeof vi.fn>; react: ReturnType<typeof vi.fn> }>();
  const remove = vi.fn(async () => undefined), react = vi.fn(async () => undefined), fetchMessage = vi.fn(() => lookup.promise);
  const f = await gatewayFixture({ channels: { fetch: async () => ({ isTextBased: () => true, messages: { fetch: fetchMessage } }) } });
  const caller = new AbortController(), message = { conversation: f.conversation, id: 'message' };
  const port = f.index.control(f.canonicalId, operation);
  if (!port?.recall || !port.addReaction) throw new Error('Expected Discord controls');
  let outcome: unknown;
  const pending = (operation === 'recall' ? port.recall({ message, signal: caller.signal }) : port.addReaction({ message, emoji: '👍', signal: caller.signal }))
    .then(value => { outcome = { value }; }, error => { outcome = { error }; });
  try {
    await vi.waitFor(() => expect(fetchMessage).toHaveBeenCalledOnce()); caller.abort();
    await vi.waitFor(() => expect(outcome).toMatchObject({ error: { disposition: 'not_sent' } }), { timeout: 200 });
    lookup.resolve({ delete: remove, react }); await pending; await new Promise(resolve => setImmediate(resolve));
    expect(remove).not.toHaveBeenCalled(); expect(react).not.toHaveBeenCalled();
  } finally { lookup.resolve({ delete: remove, react }); await pending; await f.stop(); }
});
it('keeps a submitted Gateway send unknown on cancellation and permits a separate later send', async () => {
  const ack = deferred<{ id: string }>(), send = vi.fn().mockImplementationOnce(() => ack.promise).mockResolvedValue({ id: 'next' });
  const f = await gatewayFixture({ channels: { fetch: async () => ({ isSendable: () => true, send }) } }), caller = new AbortController();
  let outcome: unknown;
  const pending = f.send({ conversation: f.conversation, payload: 'first', signal: caller.signal }).then(value => { outcome = { value }; }, error => { outcome = { error }; });
  try {
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce()); caller.abort();
    await vi.waitFor(() => expect(outcome).toMatchObject({ error: { disposition: 'unknown' } }), { timeout: 200 });
    ack.resolve({ id: 'late' }); await pending;
    await expect(f.send({ conversation: f.conversation, payload: 'second' })).resolves.toBe('next'); expect(send).toHaveBeenCalledTimes(2);
  } finally { ack.resolve({ id: 'late' }); await pending; await f.stop(); }
});
it.each(['send', 'recall'] as const)('passes Interactions %s cancellation into its actual fetch invocation', async operation => {
  const response = deferred<Response>(), calls: RequestInit[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => { calls.push(init!); return response.promise; };
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const config = resolveDiscordConfig({ id: 'synthetic', token: 'synthetic', connection: 'interactions', applicationId: 'app', publicKey: '00'.repeat(32) });
  if (config.connection !== 'interactions') throw new Error('Expected Interactions configuration');
  const f = await discordFixture(() => new DiscordInteractionsEndpoint({ id: identity, config, http, fetch }), undefined);
  await f.start(); f.open();
  const caller = new AbortController(), conversation = { endpoint: { adapter: 'discord', id: f.canonicalId }, kind: 'channel' as const, id: 'channel' };
  let outcome: unknown;
  const pending = (operation === 'send' ? f.send({ conversation, payload: 'first', signal: caller.signal })
    : f.control.recall!({ message: { conversation, id: 'message' }, signal: caller.signal }))
    .then(value => { outcome = { value }; }, error => { outcome = { error }; });
  try {
    await vi.waitFor(() => expect(calls).toHaveLength(1)); caller.abort();
    expect(calls[0]!.signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(outcome).toMatchObject({ error: { disposition: 'unknown' } }), { timeout: 200 });
    response.resolve(new Response(JSON.stringify({ id: 'late' }), { status: 200 })); await pending;
    expect(calls).toHaveLength(1);
  } finally { response.resolve(new Response(JSON.stringify({ id: 'late' }), { status: 200 })); await pending; await f.stop(); await http.close(); }
});

it('defers local attachment opening to the native SDK instead of creating an unconsumed stream during preparation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'discord-attachment-'));
  const filename = path.join(directory, 'synthetic.txt');
  try {
    await writeFile(filename, 'synthetic attachment');
    const options = await toMessageCreateOptions({ files: [{ file: filename, name: 'synthetic.txt' }] });
    const attachment = options.files?.[0]; expect(attachment).toBeInstanceOf(AttachmentBuilder);
    if (!(attachment instanceof AttachmentBuilder)) throw new Error('Expected a native AttachmentBuilder');
    expect(attachment.attachment).toBe(filename);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
