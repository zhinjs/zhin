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
  const settle = (messageId: string, candidate: Parameters<InboundOutcomeLedger['report']>[0]) => {
    const ledger = new InboundOutcomeLedger({ conversation, messageId, receivedAt: 1 });
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
  // The administrator detail stays in the outcome log; the route never returns it.
  expect(JSON.stringify(data)).not.toContain('ai.trigger.ambient');
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
