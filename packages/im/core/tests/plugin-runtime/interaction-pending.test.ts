import { afterEach, expect, it, vi } from 'vitest';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import type { DeliveryReceipt } from '@zhin.js/im-contract';
import { RuntimeMessage, type SendContent, type Segment } from '../../src/plugin-runtime/im/contracts.js';
import { RuntimeInteractionCoordinator } from '../../src/plugin-runtime/im/interaction-runtime.js';

const conversation = { endpoint: { id: 'bot', adapter: 'sandbox' }, kind: 'group' as const, id: 'room',
  parent: { kind: 'channel' as const, id: 'container' }, threadId: 'topic' };
const reply = async (): Promise<DeliveryReceipt> => ({ status: 'sent' });
const message = (text: string, payload?: string) => new RuntimeMessage(
  {
    conversation: conversation,
    content: text,
    sender: { id: 'owner' },
    metadata: {},
    segments: payload ? [{ type: 'action', data: { payload } }] : undefined,
  },
  { generation: 1, reply: reply },
);
const token = (content: SendContent) => {
  const keyboard = (content as Segment[]).find(item => item.type === 'keyboard')!;
  return (keyboard.data.rows as { payload: string }[][])[0][0].payload;
};
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

it('projects the actual delivered prompt and resolves recovered callbacks through the original single claim', async () => {
  const coordinator = new RuntimeInteractionCoordinator();
  const prompts: SendContent[] = [];
  const answer = coordinator.create({ conversation, generation: 1, locale: 'en', sender: { id: 'owner' }, $reply: async content => {
    prompts.push(content); return { status: 'sent' };
  } }).ask({ type: 'confirm', title: 'Allow tool?', description: 'Current request only' });
  await flush();
  const pending = coordinator.readPendingInteraction(conversation, 'owner', 1)!;
  expect(pending).toMatchObject({ generation: 1, subjectId: 'owner', conversation });
  expect(pending.segments).toEqual(prompts[0]);
  expect(coordinator.readPendingInteraction(conversation, 'owner', 1)?.id).toBe(pending.id);
  expect(prompts).toHaveLength(1);
  expect(coordinator.resolveClaim(message('', token(pending.segments)))).toBe(true);
  expect(coordinator.readPendingInteraction(conversation, 'owner', 1)).toBeUndefined();
  expect(coordinator.resolveClaim(message('', token(pending.segments)))).toBe(false);
  await expect(answer).resolves.toBe(true);
  expect(new RuntimeInteractionCoordinator().readPendingInteraction(conversation, 'owner', 1)).toBeUndefined();
});

it('filters exact endpoint, subject, generation, parent and topic without exposing another claim', async () => {
  const coordinator = new RuntimeInteractionCoordinator(), abort = new AbortController();
  const answer = coordinator.create({ conversation, generation: 1, sender: { id: 'owner' }, $reply: reply })
    .ask({ type: 'text', title: 'Question', signal: abort.signal }).catch(error => error);
  await flush();
  expect(coordinator.readPendingInteraction(conversation, 'other', 1)).toBeUndefined();
  expect(coordinator.readPendingInteraction(conversation, 'owner', 2)).toBeUndefined();
  for (const other of [{ ...conversation, id: 'other' }, { ...conversation, endpoint: { ...conversation.endpoint, id: 'other' } },
    { ...conversation, parent: undefined }, { ...conversation, threadId: 'other' }]) {
    expect(coordinator.readPendingInteraction(other, 'owner', 1)).toBeUndefined();
  }
  abort.abort(); await answer;
  expect(coordinator.readPendingInteraction(conversation, 'owner', 1)).toBeUndefined();
});

it('does not claim delivery or reactivate a failed send when a browser reads pending state', async () => {
  const coordinator = new RuntimeInteractionCoordinator();
  let finish!: (receipt: DeliveryReceipt) => void;
  const sent = new Promise<DeliveryReceipt>(resolve => { finish = resolve; });
  const answer = coordinator.create({ conversation, generation: 1, sender: { id: 'owner' }, $reply: () => sent })
    .ask({ type: 'text', title: 'Not delivered' }).catch(error => error);
  expect(coordinator.readPendingInteraction(conversation, 'owner', 1)).toBeUndefined();
  finish({ status: 'failed', failure: { code: 'network_error', message: 'unknown delivery', deliveryUnknown: true } });
  await expect(answer).resolves.toMatchObject({ name: 'UserInteractionDeliveryError' });
  expect(coordinator.readPendingInteraction(conversation, 'owner', 1)).toBeUndefined();
});

it('keeps expiry and current invalid-answer retry prompt instead of reviving cached controls', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const coordinator = new RuntimeInteractionCoordinator();
  const answer = coordinator.create({ conversation, generation: 1, sender: { id: 'owner' }, $reply: reply })
    .ask({ type: 'select', title: 'Choose', options: [{ label: 'One', value: 'one' }], timeout: 100 }).catch(error => error);
  await flush();
  const first = coordinator.readPendingInteraction(conversation, 'owner', 1)!;
  expect(first.expiresAt).toBe(1100);
  expect(coordinator.resolveClaim(message('invalid'))).toBe(true);
  await flush();
  const current = coordinator.readPendingInteraction(conversation, 'owner', 1)!;
  expect(current.id).not.toBe(first.id);
  expect(current.expiresAt).toBe(first.expiresAt);
  expect(current.segments).not.toEqual(first.segments);
  expect(coordinator.resolveClaim(message('', token(first.segments)))).toBe(false);
  vi.setSystemTime(1100);
  expect(coordinator.readPendingInteraction(conversation, 'owner', 1)).toBeUndefined();
  await vi.advanceTimersByTimeAsync(100);
  await expect(answer).resolves.toMatchObject({ name: 'UserInteractionTimeoutError' });
});

it('removes a pending question on explicit Root stop without resurrecting its projection', async () => {
  const root = rootPluginId();
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test',
    packageRoot: '/test', children: [] }]]), config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map() };
  const store = new SnapshotStore(state), lease = store.acquire(), coordinator = new RuntimeInteractionCoordinator();
  const answer = coordinator.create({ conversation, generation: 0, sender: { id: 'owner' }, $reply: reply }, undefined,
    { snapshot: lease.value, owner: root, signal: lease.stopSignal }).ask({ type: 'confirm', title: 'Before reload' }).catch(error => error);
  await flush();
  expect(coordinator.readPendingInteraction(conversation, 'owner', 0)).toBeDefined();
  const closing = store.close();
  expect(coordinator.readPendingInteraction(conversation, 'owner', 0)).toBeUndefined();
  expect(coordinator.readPendingInteraction(conversation, 'owner', 1)).toBeUndefined();
  await expect(answer).resolves.toMatchObject({ name: 'AbortError' });
  lease.release(); await closing;
});
