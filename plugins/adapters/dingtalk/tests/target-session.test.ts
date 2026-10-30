import https from 'node:https';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { AdapterIndex, adapterFeatureId, endpointEventGatewayToken, type AdapterDefinition } from 'zhin.js/adapter';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState, type TokenId, type FeatureId } from 'zhin.js';
import { HandlerIndex, handlerFeatureId } from '../../../../packages/im/handler/src/index.js';
import { readOperationSession, type OperationSession } from '@zhin.js/feature-kit';
import { ImRuntime } from '@zhin.js/core/runtime';
import { defineHandler } from '../../../../packages/im/core/src/feature/handler.js';
import dingtalk from '../adapters/dingtalk/index.js';
import lark from '../../lark/adapters/lark/index.js';
import line from '../../line/adapters/line/index.js';
import wecom from '../../wecom/adapters/wecom/index.js';
import mp from '../../wechat-mp/adapters/wechat-mp/index.js';
import ilink from '../../weixin-ilink/adapters/weixin-ilink/index.js';
import email from '../../email/adapters/email/index.js';
import github from '../../github/adapters/github/index.js';
import { DingTalkEndpoint } from '../src/endpoint.js';
import { LarkEndpoint } from '../../lark/src/endpoint.js';
import { LineEndpoint } from '../../line/src/endpoint.js';
import { WecomEndpoint } from '../../wecom/src/endpoint.js';
import { WeChatMpEndpoint } from '../../wechat-mp/src/endpoint.js';
import { WeixinIlinkEndpoint } from '../../weixin-ilink/src/endpoint.js';
import { EmailEndpoint } from '../../email/src/endpoint.js';
import { GithubEndpoint } from '../../github/src/endpoint.js';
import { GhClient } from '../../github/src/gh-client.js';
import * as transports from '../../email/src/transport.js';
import type { EmailImapTransport } from '../../email/src/transport.js';
import * as ilinkApi from '../../weixin-ilink/src/ilink-api.js';
import { idleIlinkUpdates } from '../../weixin-ilink/tests/transport-fixture.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const cases = [
  ['dingtalk', dingtalk, { appKey: 'synthetic-app', appSecret: 'synthetic-secret' }],
  ['lark', lark, { appId: 'synthetic-app', appSecret: 'synthetic-secret' }],
  ['line', line, { channelSecret: 'synthetic-secret', channelAccessToken: 'synthetic-token' }],
  ['wecom', wecom, { corpId: 'synthetic-corp', agentId: '100001', agentSecret: 'synthetic-secret', token: 'synthetic-callback', encodingAESKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG' }],
  ['wechat-mp', mp, { appId: 'synthetic-app', appSecret: 'synthetic-secret', token: 'synthetic-callback', replyMode: 'customer_service' }],
  ['weixin-ilink', ilink, { botToken: 'synthetic-token' }],
  ['email', email, { smtp: { host: 'smtp.fixture', port: 465, secure: true, auth: { user: 'sender', pass: 'synthetic' } }, imap: { host: 'imap.fixture', port: 993, tls: true, user: 'reader', password: 'synthetic' } }],
  ['github', github, { app_id: '123456', private_key: 'synthetic-unused' }],
] as const;

it.each(cases)('retains %s actual Client and native event through convention → AdapterIndex → Core OperationSession', async (platform, definition, config) => {
  const directory = await mkdtemp(join(tmpdir(), 'http-native-session-')), http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const deniedHttps = vi.spyOn(https, 'request').mockImplementation(() => { throw new Error('Unexpected external HTTPS in synthetic target-session test'); });
  expect(() => https.request('https://must-not-connect.invalid')).toThrow('Unexpected external HTTPS');
  deniedHttps.mockClear();
  const requireMp = createRequire(new URL('../../wechat-mp/package.json', import.meta.url));
  const axios = (await import(pathToFileURL(join(dirname(requireMp.resolve('axios/package.json')), 'index.js')).href)).default;
  const originalAxiosAdapter = axios.defaults.adapter;
  const axiosTransport = vi.fn(async (config: unknown) => ({ config, status: 200, statusText: 'OK', headers: {}, data: { access_token: 'synthetic-token', expires_in: 7200 } }));
  axios.defaults.adapter = axiosTransport;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, errcode: 0, access_token: 'synthetic-token', tenant_access_token: 'synthetic-token', expire: 7200, expires_in: 7200 }))));
  vi.spyOn(GhClient.prototype, 'verifyAuth').mockResolvedValue({ ok: true, user: 'bot', message: 'synthetic' });
  vi.spyOn(transports, 'defaultCreateSmtp').mockImplementation(() => ({ verify: async () => undefined, close() {}, sendMail: async () => ({}) }));
  vi.spyOn(transports, 'defaultCreateImap').mockImplementation(() => {
    const events = new EventEmitter();
    const connection: EmailImapTransport = {
      once: (event, listener) => { events.once(event, listener); }, on: (event, listener) => { events.on(event, listener); },
      connect: () => { queueMicrotask(() => events.emit('ready')); }, end: () => { events.emit('end'); },
      openBox: (_name, _write, done) => done(null, {}), search: (_criteria, done) => done(null, []), fetch: () => { throw new Error('No mailbox fetch expected'); },
    };
    return connection;
  });
  vi.spyOn(ilinkApi, 'notifyStart').mockResolvedValue({}); vi.spyOn(ilinkApi, 'notifyStop').mockResolvedValue({}); vi.spyOn(ilinkApi, 'getUpdates').mockImplementation(idleIlinkUpdates);
  const owner = rootPluginId(), im = new ImRuntime(), sessions: Array<OperationSession<string> | undefined> = [];
  const adapterSlot = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: platform, source: `/fixture/adapters/${platform}/index.ts`, definition: definition as AdapterDefinition });
  const handler = createCapabilitySlot({ owner, feature: handlerFeatureId, localName: 'capture', source: '/fixture/handlers/capture/index.ts',
    definition: defineHandler({ event: 'message.receive', async handle(event) { sessions.push(readOperationSession(event)); } }) });
  const slots = [adapterSlot, handler];
  const state: SnapshotState = { root: owner, tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: 'fixture', packageRoot: directory, children: [] }]]),
    config: new Map([[owner, { ...config, id: 'bot', dataDir: directory }]]), resources: new Map([[owner, new Map<TokenId, unknown>([[endpointEventGatewayToken.id, im.endpointEvents], [httpHostToken.id, http]])]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map() };
  const view = createSnapshotView(1, state), index = await AdapterIndex.create([adapterSlot], view, new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map<FeatureId, unknown>([[adapterFeatureId, index], [handlerFeatureId, new HandlerIndex([handler], view)]]) });
  im.attach(store);
  try {
    const adapter = index.adapter(adapterSlot.id)!, endpoint = adapter.getEndpoint(adapter.list()[0]!.instanceId)!;
    expect(Object.hasOwn(Object.getPrototypeOf(endpoint), 'start')).toBe(false);
    await index.start(); index.open();
    let native: unknown;
    if (endpoint instanceof DingTalkEndpoint) { const event = { msgtype: 'text', msgId: 'native-message', conversationId: 'room', conversationType: '1', senderId: 'actual-user', text: { content: 'hello' } }; native = event; await endpoint.admit(event); }
    else if (endpoint instanceof LarkEndpoint) { const event = { message_id: 'native-message', chat_id: 'room', chat_type: 'p2p', sender: { sender_id: { open_id: 'actual-user' } }, message_type: 'text', content: '{"text":"hello"}' }; native = event; endpoint.admit(event); }
    else if (endpoint instanceof LineEndpoint) { const event = { type: 'message', replyToken: 'synthetic-reply', source: { type: 'user', userId: 'actual-user' }, timestamp: 1, message: { id: 'native-message', type: 'text', text: 'hello' } } as const; native = event; await endpoint.admitAccepted(event); }
    else if (endpoint instanceof WecomEndpoint) { const event = { ToUserName: 'bot', FromUserName: 'actual-user', CreateTime: 1, MsgType: 'text', Content: 'hello', MsgId: 'native-message', rawXml: '<xml native="wecom" />' }; native = event.rawXml; endpoint.admit(event); }
    else if (endpoint instanceof WeChatMpEndpoint) { native = '<xml native="wechat-mp" />'; await endpoint.admit({ ToUserName: 'bot', FromUserName: 'actual-user', CreateTime: 1, MsgType: 'text', Content: 'hello', MsgId: 'native-message' }, native); }
    else if (endpoint instanceof WeixinIlinkEndpoint) { const event = { from_user_id: 'actual-user', message_id: 1, item_list: [{ type: 1, text_item: { text: 'hello' } }] }; native = event; await endpoint.admit(event); }
    else if (endpoint instanceof EmailEndpoint) { const event = { from: 'actual-user@example.test', to: ['bot@example.test'], subject: '', text: 'hello', messageId: 'native-message', date: new Date(1), attachments: [], uid: 1 }; native = event; endpoint.admit(event); }
    else if (endpoint instanceof GithubEndpoint) { const event = { action: 'created', unrecognized: { native: true } }; native = event; endpoint.admit({ id: 'native-message', channelId: 'owner/repo#1', sender: 'actual-user', content: 'hello', repo: 'owner/repo', kind: 'issue_comment', createdAt: 1 }, event); }
    else throw new Error('Convention returned an unexpected endpoint type');
    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0]?.adapter).toBe(adapter); expect(sessions[0]?.endpoint).toBe(endpoint); expect(sessions[0]?.event).toBe(native);
    expect(deniedHttps).not.toHaveBeenCalled();
    expect(axiosTransport).toHaveBeenCalledTimes(platform === 'wechat-mp' ? 1 : 0);
    expect(sessions[0]?.message.text).toContain('hello'); expect(sessions[0]?.sender?.id).toContain('actual-user');
  } finally { axios.defaults.adapter = originalAxiosAdapter; await index.stop(); await store.close(); await http.close(); await rm(directory, { recursive: true, force: true }); }
});
