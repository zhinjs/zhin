/**
 * zhinjs/zhin#1250 (`unaddressed-message-no-record`): the Sandbox reads why a message it sent got
 * no reply. A group message nobody addressed (「天气 上海」) settles as `not_addressed`, and the
 * route returns that outcome — code, reason and the sender-facing text — for the live binding only.
 */
import { withTestUsers } from '../utils/console-users.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { adapterFeatureId } from '@zhin.js/adapter';
import { InboundOutcomeLedger, MessageOutcomeLog } from '@zhin.js/core/runtime';
import { registerConversationOutcomeRoutes } from '../../../src/instance/console/conversation-outcome-routes.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function fixture() {
  const root = rootPluginId();
  const connection = { target: 'bot', owner: 'configured-owner', placeholder: false, socket: { readyState: 1 } };
  const index = { $projection: 'zhin.adapter-index/1', describe: () => [{ id: 'canonical', name: 'bot', admitted: true }],
    clientAdapter: () => 'sandbox', capabilityProfile: () => ({ default: { runtime: { sandbox: true } } }),
    clientById: () => ({ connectionById: (id: string) => id === 'live' ? connection : undefined }) };
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: '/x', children: [] }]]),
    config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map([[adapterFeatureId, index]]) };
  const snapshots = new SnapshotStore(state);
  const outcomes = new MessageOutcomeLog();
  const http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), { full: 'owner', demo: 'none' });
  cleanups.push(() => snapshots.close(), () => http.close());
  registerConversationOutcomeRoutes({ http, base: '/api', outcomes, snapshots });
  const { port } = await http.listen();
  const conversation = { endpoint: { adapter: 'sandbox', id: 'canonical' }, kind: 'group' as const, id: '测试群' };
  // The Sandbox page speaks as the connection owner by default: `~sim:<owner>` (ADR 0060 §5.4).
  const settle = (messageId: string, candidate: Parameters<InboundOutcomeLedger['report']>[0], senderId = '~sim:configured-owner') => {
    const ledger = new InboundOutcomeLedger({ conversation, messageId, senderId, receivedAt: 1 });
    ledger.report(candidate);
    outcomes.record(ledger.settle());
  };
  const request = (query: Record<string, string> = {}, token = 'full') => fetch(`http://127.0.0.1:${port}/api/conversations/outcomes?${new URLSearchParams({
    connectionId: 'live', sessionKey: 'sandbox:bot:group:测试群', ...query })}`, { headers: { authorization: `Bearer ${token}` } });
  return { request, settle, connection };
}

it('returns the outcome of a Sandbox group message nobody addressed, with its reason and text', async () => {
  const f = await fixture();
  f.settle('m-weather', { outcome: 'not_addressed', reason: 'no_command_not_ambient', stage: 'ambient',
    detail: 'this group is not in ai.trigger.ambient.conversations' });
  const response = await f.request({ messageId: 'm-weather' });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const data = (await response.json()).data;
  expect(data.outcomes).toHaveLength(1);
  expect(data.outcomes[0]).toMatchObject({ messageId: 'm-weather', outcome: 'not_addressed', reason: 'no_command_not_ambient',
    reply: 'no', addressed: false, text: '这条消息没有 @ 我，也不是指令，本群我只在被 @ 时回复。' });
  // The administrator detail stays in the outcome log; the route never returns it, nor the operator text.
  expect(JSON.stringify(data)).not.toContain('ai.trigger.ambient');
  expect(data.outcomes[0]).not.toHaveProperty('adminText');
  const en = (await (await f.request({ messageId: 'm-weather', locale: 'en' })).json()).data;
  expect(en.outcomes[0].text).toMatch(/^You did not mention me/u);
  // Not settled yet: an empty list (the page asks again).
  expect((await (await f.request({ messageId: 'm-unknown' })).json()).data.outcomes).toEqual([]);
});

it('returns a command refusal with its reason (#1250 self-service-unknown-conversation-opaque)', async () => {
  const f = await fixture();
  f.settle('m-feature', { outcome: 'refused', reason: 'simulated-sender', stage: 'command', command: 'feature' });
  const data = (await (await f.request({ messageId: 'm-feature' })).json()).data;
  expect(data.outcomes[0]).toMatchObject({ outcome: 'refused', reason: 'simulated-sender', reply: 'yes', command: 'feature' });
});

it('answers only for the live binding and the caller\'s permission', async () => {
  const f = await fixture();
  expect((await f.request({}, 'demo')).status).toBe(403);
  expect((await f.request({ connectionId: 'old' })).status).toBe(503);
  expect((await f.request({ sessionKey: 'sandbox:other:group:测试群' })).status).toBe(403);
  expect((await f.request({ sessionKey: 'sandbox:bot:invalid:x' })).status).toBe(400);
  expect((await f.request({ messageId: '' })).status).toBe(400);
});

it('lists only the connection owner\'s messages, never another principal\'s under the same target', async () => {
  const f = await fixture();
  f.settle('m-own', { outcome: 'not_addressed', reason: 'no_command_not_ambient', stage: 'ambient' });
  f.settle('m-own-raw', { outcome: 'command_replied', stage: 'command', command: 'help', owner: 'help-plugin' }, 'configured-owner');
  f.settle('m-other', { outcome: 'refused', reason: 'not-admin', stage: 'command', command: 'feature' }, '~sim:someone-else');
  f.settle('m-real', { outcome: 'command_replied', stage: 'command', command: 'help' }, '10001');
  const all = (await (await f.request()).json()).data.outcomes as { messageId: string }[];
  expect(all.map(outcome => outcome.messageId).sort()).toEqual(['m-own', 'm-own-raw']);
  // Asking for another principal's message id by name does not reveal it either.
  expect((await (await f.request({ messageId: 'm-other' })).json()).data.outcomes).toEqual([]);
  expect((await (await f.request({ messageId: 'm-real' })).json()).data.outcomes).toEqual([]);
  // No plugin name (operator text) in the response.
  expect(JSON.stringify(all)).not.toContain('help-plugin');
});

it('answers an unsupported ?locale= with 400 invalid_locale and keeps the default without one (#1250 batch 77)', async () => {
  const f = await fixture();
  f.settle('m-weather', { outcome: 'not_addressed', reason: 'no_command_not_ambient', stage: 'ambient' });
  for (const locale of ['en-US', 'fr', '']) {
    const response = await f.request({ messageId: 'm-weather', locale });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, code: 'invalid_locale', error: 'locale 只能是 zh-CN 或 en（locale must be zh-CN or en）' });
  }
  const absent = await f.request({ messageId: 'm-weather' });
  expect(absent.status).toBe(200);
  expect((await absent.json()).data.outcomes[0].text).toBe('这条消息没有 @ 我，也不是指令，本群我只在被 @ 时回复。');
});

