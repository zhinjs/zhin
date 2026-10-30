import { endpointSpec } from 'zhin.js/adapter';
import { createEndpointHarness } from '../../test-utils/endpoint.js';
import { DiscordInteractionsEndpoint } from '../src/endpoint.js';
import { Readable } from 'node:stream';
import { generateKeyPairSync, sign } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleDiscordInteractionRequest } from '../src/webhook.js';
import { resolveDiscordConfig, type ResolvedDiscordInteractionsConfig } from '../src/protocol.js';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const config = resolveDiscordConfig({ id: 'fixture', token: 'fixture', connection: 'interactions', applicationId: 'fixture-app', publicKey }) as ResolvedDiscordInteractionsConfig;
async function invoke(locale: 'en' | 'zh-CN' | undefined, valid = true, type = 2, application: { application_id?: unknown } = { application_id: config.applicationId }) {
  const resolveLocale = vi.fn(async () => locale);
  const admit = vi.fn();
  const admitPlatform = vi.fn();
  const end = vi.fn();
  const writeHead = vi.fn();
  const timestamp = String(Math.floor(Date.now() / 1000));
  // Platform-provided locale must not override Zhin's trusted operation preference.
  const body = JSON.stringify({ id: 'command', type, ...application, locale: 'zh-CN', channel_id: 'room', user: { id: 'sender', username: 'Alice' }, data: { name: '用户命令' } });
  const signature = sign(null, Buffer.from(timestamp + body), keys.privateKey).toString('hex');
  const request = Object.assign(Readable.from([Buffer.from(body)]), { headers: { 'x-signature-ed25519': valid ? signature : '00'.repeat(64), 'x-signature-timestamp': timestamp } });
  const h = await createEndpointHarness(() => new DiscordInteractionsEndpoint({ id: 'discord-protocol' as never, config,
    http: { route: () => () => undefined } as never }), { capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: { receive: async () => undefined, resolveLocale } });
  vi.spyOn(h.endpoint, 'admit').mockImplementation(admit);
  vi.spyOn(h.endpoint, 'admitButton').mockImplementation(() => undefined);
  vi.spyOn(h.endpoint, 'admitPlatform').mockImplementation(admitPlatform);
  await h.start(); h.open();
  try { await handleDiscordInteractionRequest(request as IncomingMessage, { end, writeHead } as unknown as ServerResponse, h.endpoint); }
  finally { await h.stop(); }
  return { resolveLocale, identity: h.endpoint[endpointSpec].identity, admit, admitPlatform, end, writeHead };
}

it.each([['en', 'Processing command: 用户命令'], ['zh-CN', '处理命令: 用户命令'], [undefined, '处理命令: 用户命令']] as const)(
  'localizes the %s ephemeral slash acknowledgement without changing command content', async (locale, content) => {
    const result = await invoke(locale);
    expect(result.resolveLocale).toHaveBeenCalledExactlyOnceWith(result.identity, 'sender');
    expect(JSON.parse(result.end.mock.calls[0]![0])).toEqual({ type: 4, data: { flags: 64, content } });
    expect(result.admit).toHaveBeenCalledOnce();
    expect(result.admit.mock.calls[0]?.[0]).toMatchObject({ authorId: 'sender', content: '/用户命令' });
  },
);
it('does not resolve identities or admit commands before signature verification', async () => {
  const result = await invoke('en', false);
  expect(result.writeHead).toHaveBeenCalledWith(401, expect.anything());
  expect(result.resolveLocale).not.toHaveBeenCalled();
  expect(result.admit).not.toHaveBeenCalled();
});
it('does not add a preference lookup to the protocol ping', async () => {
  const result = await invoke('en', true, 1);
  expect(result.resolveLocale).not.toHaveBeenCalled();
  expect(JSON.parse(result.end.mock.calls[0]![0])).toEqual({ type: 1 });
});

it.each([{}, { application_id: 'other-app' }, { application_id: null }])('rejects a signed interaction for an unproved application %j before all dispatch', async application => {
  const result = await invoke('en', true, 1, application);
  expect(result.writeHead).toHaveBeenCalledWith(401, expect.anything());
  expect(result.admit).not.toHaveBeenCalled();
  expect(result.admitPlatform).not.toHaveBeenCalled();
  expect(result.resolveLocale).not.toHaveBeenCalled();
});
