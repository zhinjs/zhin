import { channelKey } from '../src/board-sender.js';
import { sendGameSessionMessage } from '../src/session-delivery.js';
import {
  extractChannelInfo as rssChannel,
  subscriptionScope as rssScope,
} from '../../../plugins/utils/rss/src/channel.js';
import {
  extractChannelInfo as biliChannel,
  subscriptionScope as biliScope,
} from '../../../plugins/utils/bilibili/src/channel.js';
import { extractConversation } from '../../../plugins/utils/earthquake/src/conversation.js';
import { SubscriptionStore, createMemoryState } from '../../../plugins/utils/earthquake/src/subscriptions.js';
import { decodeTaskTarget } from 'zhin.js/plugin-runtime';

const target = { endpoint: { adapter: 'icqq', id: 'canonical\0first' }, kind: 'group' as const, id: 'group' };
function incoming(id: string) {
  return {
    conversation: { ...target, endpoint: { ...target.endpoint, id } },
    sender: { id: 'person' },
    clientAdapter: 'icqq',
    endpointId: 'same-display-alias',
    metadata: { endpoint: 'same-display-alias' },
  };
}

it.each([
  { name: 'RSS', read: rssChannel, scope: rssScope },
  { name: 'Bilibili', read: biliChannel, scope: biliScope },
])('$name stores replacement identities independently of a reused display alias', ({ read, scope }) => {
  const first = read(incoming('canonical\0first'))!,
    second = read(incoming('canonical\0second'))!;
  const a = scope(first),
    b = scope(second);
  expect(a).not.toEqual(b);
  expect(a.endpoint_id).not.toContain('\0');
  expect(decodeTaskTarget(JSON.parse(a.target_json!))).toEqual(first.target);
  expect(decodeTaskTarget(JSON.parse(b.target_json!))).toEqual(second.target);
});

it('keeps earthquake captures distinct through an actual persisted-state reload', async () => {
  const state = createMemoryState(),
    store = new SubscriptionStore(state, { maxSubscriptions: 10 });
  for (const id of ['canonical\0first', 'canonical\0second']) {
    const destination = extractConversation(incoming(id))!;
    await store.upsert({ ...destination, minMagnitude: 4, regions: [], createdBy: 'person', createdAt: 'synthetic' });
  }
  const restored = await new SubscriptionStore(state, { maxSubscriptions: 10 }).list();
  expect(restored.map((row) => row.target?.endpoint.id)).toEqual(['canonical\0first', 'canonical\0second']);
});

it('restores a delayed game destination including parent and thread without consulting row aliases', async () => {
  const scene = {
    ...target,
    kind: 'private' as const,
    id: 'person',
    parent: { kind: 'group' as const, id: 'group' },
    threadId: 'topic',
  };
  const session = JSON.parse(
    JSON.stringify({
      id: 'game',
      status: 'lobby',
      updated_at: 0,
      channel_key: channelKey({ target: scene }),
      adapter: 'wrong-adapter',
      endpoint: 'reused-alias',
      channel_type: 'private',
      channel_id: 'wrong-person',
    }),
  );
  const send = vi.fn(),
    sendTarget = vi.fn(async () => 'message');
  await expect(sendGameSessionMessage({ outbound: { send, sendTarget }, session, content: 'timeout' })).resolves.toBe(
    'message',
  );
  expect(sendTarget).toHaveBeenCalledExactlyOnceWith(scene, 'timeout', { locale: 'zh-CN' });
  expect(send).not.toHaveBeenCalled();
});

it('never rebinds a failed canonical delivery through historical selectors', async () => {
  const session = {
    id: 'game',
    status: 'lobby',
    updated_at: 0,
    channel_key: channelKey({ target }),
    adapter: 'icqq',
    endpoint: 'same-display-alias',
    channel_type: 'group',
    channel_id: 'group',
  };
  const send = vi.fn(),
    sendTarget = vi.fn(async () => {
      throw new Error('canonical account unavailable');
    });
  await expect(sendGameSessionMessage({ outbound: { send, sendTarget }, session, content: 'timeout' })).rejects.toThrow(
    'canonical account unavailable',
  );
  expect(send).not.toHaveBeenCalled();
  await expect(
    sendGameSessionMessage({
      outbound: { send, sendTarget },
      session: { ...session, channel_key: 'game-target-v1:invalid' },
      content: 'timeout',
    }),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

it('preserves unresolved historical records without alias delivery after the approved migration cutover', async () => {
  const session = {
    id: 'legacy',
    status: 'lobby',
    updated_at: 0,
    channel_key: 'icqq:saved-name:group:group',
    adapter: 'icqq',
    endpoint: 'saved-name',
    channel_type: 'group',
    channel_id: 'group',
  };
  const before = structuredClone(session),
    send = vi.fn(),
    sendTarget = vi.fn();
  await expect(
    sendGameSessionMessage({ outbound: { send, sendTarget }, session, content: 'timeout' }),
  ).rejects.toMatchObject({ code: 'unavailable' });
  expect(send).not.toHaveBeenCalled();
  expect(sendTarget).not.toHaveBeenCalled();
  expect(session).toEqual(before);
});
