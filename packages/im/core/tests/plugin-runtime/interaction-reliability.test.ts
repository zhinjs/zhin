import { describe, expect, it, vi } from 'vitest';
import { SnapshotStore, rootPluginId, createGenerationAdmissionGate, outboundHostToken, PluginOutboundHost,
  type SnapshotState } from '@zhin.js/plugin-runtime';
import type { DeliveryReceipt } from '@zhin.js/im-contract';
import { RuntimeMessage, type SendContent, type Segment } from '../../src/plugin-runtime/im/contracts.js';
import { RuntimeInteractionCoordinator } from '../../src/plugin-runtime/im/interaction-runtime.js';

const conversation = { endpoint: { id: 'endpoint', adapter: 'memory' }, kind: 'group' as const, id: 'room',
  parent: { kind: 'channel' as const, id: 'parent' }, threadId: 'topic' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function message(content: string, generation = 1, sender = 'alice', segments?: readonly Segment[]) {
  return new RuntimeMessage(
    {
      conversation: conversation,
      content: content,
      sender: { id: sender },
      metadata: {},
      segments: segments,
    },
    { generation: generation, reply: async () => ({ status: 'sent' }) },
  );
}
function actionToken(content: SendContent, index = 0): string {
  const keyboard = (content as Segment[]).find(segment => segment.type === 'keyboard')!;
  return (keyboard.data.rows as { payload: string }[][])[0][index].payload;
}

describe('UserInteraction claim reliability', () => {
  it('accepts the current native callback while the prompt is still being sent', async () => {
    const coordinator = new RuntimeInteractionCoordinator();
    const sending = deferred<DeliveryReceipt>();
    const answer = coordinator.create({ conversation, generation: 1, sender: { id: 'alice' }, $reply: content => {
      const token = actionToken(content);
      expect(coordinator.resolveClaim(message('', 1, 'alice', [{ type: 'action', data: { payload: token } }]))).toBe(true);
      return sending.promise;
    } }).ask({ type: 'confirm', title: '确认' });
    sending.resolve({ status: 'sent' });
    await expect(answer).resolves.toBe(true);
  });

  it('buffers an answer arriving during delivery and waits for its sent receipt', async () => {
    const coordinator = new RuntimeInteractionCoordinator();
    const sending = deferred<DeliveryReceipt>();
    const reply = vi.fn(() => {
      expect(coordinator.resolveClaim(message('early answer'))).toBe(true);
      return sending.promise;
    });
    let settled = false;
    const answer = coordinator.create({ conversation, generation: 1, sender: { id: 'alice' }, $reply: reply })
      .ask({ type: 'text', title: '姓名' }).then(value => { settled = true; return value; });
    await Promise.resolve();
    expect(settled).toBe(false);
    sending.resolve({ status: 'sent' });
    await expect(answer).resolves.toBe('early answer');
    expect(coordinator.resolveClaim(message('later answer'))).toBe(false);
  });

  it.each(['rejected', 'suppressed', 'failed'] as const)('revokes buffered input after %s delivery without retry', async status => {
    const coordinator = new RuntimeInteractionCoordinator();
    const sending = deferred<DeliveryReceipt>();
    const reply = vi.fn(() => sending.promise);
    const answer = coordinator.create({ conversation, generation: 1, sender: { id: 'alice' }, $reply: reply })
      .ask({ type: 'text', title: '姓名', default: 'must not use default' }).catch(error => error);
    expect(coordinator.resolveClaim(message('early'))).toBe(true);
    sending.resolve(status === 'suppressed' ? { status } : { status, failure: { code: 'network_error',
      message: 'fixture delivery failure', ...(status === 'failed' ? { deliveryUnknown: true } : {}) } });
    await expect(answer).resolves.toMatchObject({ name: 'UserInteractionDeliveryError' });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(coordinator.resolveClaim(message('later'))).toBe(false);
  });

  it('cleans an initial thrown send and the retry-prompt delivery gap', async () => {
    const coordinator = new RuntimeInteractionCoordinator();
    const failure = new Error('send failed');
    const reply = vi.fn(async () => { throw failure; });
    await expect(coordinator.create({ conversation, generation: 1, sender: { id: 'alice' }, $reply: reply })
      .ask({ type: 'text', title: '姓名' })).rejects.toBe(failure);
    expect(coordinator.resolveClaim(message('unclaimed'))).toBe(false);
    let prompts = 0;
    const retried = coordinator.create({ conversation, generation: 1, sender: { id: 'alice' }, $reply: async () => {
      prompts++;
      expect(coordinator.resolveClaim(message(prompts === 1 ? 'invalid' : '12'))).toBe(true);
      return { status: 'sent' };
    } }).ask({ type: 'number', title: '数量' });
    await expect(retried).resolves.toBe(12);
    expect(prompts).toBe(2);
  });

  it('does not let a late superseded send remove the new question', async () => {
    const coordinator = new RuntimeInteractionCoordinator();
    const firstSend = deferred<DeliveryReceipt>();
    const first = coordinator.create({ conversation, generation: 1, sender: { id: 'alice' }, $reply: () => firstSend.promise })
      .ask({ type: 'text', title: 'old' }).catch(error => error);
    const current = coordinator.create({ conversation, generation: 1, sender: { id: 'alice' }, $reply: async () => ({ status: 'sent' }) })
      .ask({ type: 'text', title: 'new' });
    firstSend.resolve({ status: 'sent' });
    await expect(first).resolves.toMatchObject({ name: 'UserInteractionSupersededError' });
    expect(coordinator.resolveClaim(message('new answer'))).toBe(true);
    await expect(current).resolves.toBe('new answer');
  });

  it('keeps one deadline across invalid answers and removes abort listeners', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new RuntimeInteractionCoordinator();
      const abort = new AbortController();
      const remove = vi.spyOn(abort.signal, 'removeEventListener');
      const reply = vi.fn(async () => ({ status: 'sent' as const }));
      const answer = coordinator.create({ conversation, generation: 1, sender: { id: 'alice' }, $reply: reply })
        .ask({ type: 'number', title: '数量', timeout: 100, signal: abort.signal }).catch(error => error);
      await vi.advanceTimersByTimeAsync(60);
      expect(coordinator.resolveClaim(message('invalid'))).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(reply).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(40);
      await expect(answer).resolves.toMatchObject({ name: 'UserInteractionTimeoutError' });
      expect(coordinator.hasPendingAnswer(conversation, 'alice', 1)).toBe(false);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('does not apply a timeout default after cancellation during pending delivery', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new RuntimeInteractionCoordinator();
      const sending = deferred<DeliveryReceipt>();
      const abort = new AbortController();
      const answer = coordinator.create({ conversation, generation: 1, sender: { id: 'alice' }, $reply: () => sending.promise })
        .ask({ type: 'text', title: '姓名', timeout: 10, default: 'must not use default', signal: abort.signal }).catch(error => error);
      await vi.advanceTimersByTimeAsync(10);
      abort.abort();
      sending.resolve({ status: 'sent' });
      await expect(answer).resolves.toMatchObject({ name: 'AbortError' });
      expect(coordinator.hasPendingAnswer(conversation, 'alice', 1)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('keeps question cancellation explicit without reopening the retired owner facade', async () => {
    const coordinator = new RuntimeInteractionCoordinator();
    const root = rootPluginId();
    const gate = createGenerationAdmissionGate();
    const host = new PluginOutboundHost(root, { send: async () => null }, gate);
    const caller = new AbortController();
    const state: SnapshotState = { root, tree: new Map(), config: new Map(),
      resources: new Map([[root, new Map([[outboundHostToken.id, host]])]]), capabilities: new Map(), projections: new Map() };
    const store = new SnapshotStore(state);
    const lease = store.acquire();
    const reply = vi.fn(async () => ({ status: 'sent' as const }));
    const answer = coordinator.create({ conversation, generation: 0, sender: { id: 'alice' }, $reply: reply }, undefined,
      { snapshot: lease.value, owner: root }).ask({ type: 'text', title: '姓名', default: 'must not use default', signal: caller.signal }).catch(error => error);
    await Promise.resolve();
    store.commit(0, { snapshot: { ...state, resources: new Map() }, dispose() {} });
    expect(coordinator.hasPendingAnswer(conversation, 'alice', 0)).toBe(true);
    await expect(host.send({ adapter: 'test', endpointKey: 'main', conversation, content: 'inactive' })).rejects.toThrow('inactive generation');
    caller.abort();
    await expect(answer).resolves.toMatchObject({ name: 'AbortError' });
    expect(lease.active).toBe(true);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(coordinator.resolveClaim(message('old input', 0))).toBe(false);
    lease.release();
    await store.close();
  });

  it('binds native callbacks to this question, sender, canonical conversation and generation', async () => {
    const coordinator = new RuntimeInteractionCoordinator();
    const prompts: SendContent[] = [];
    const interaction = coordinator.create({ conversation, generation: 1, sender: { id: 'alice' }, $reply: async content => {
      prompts.push(content); return { status: 'sent' };
    } });
    const first = interaction.ask({ type: 'confirm', title: '第一题' }).catch(error => error);
    const oldToken = actionToken(prompts[0]);
    const second = interaction.ask({ type: 'confirm', title: '第二题' });
    const token = actionToken(prompts[1]);
    expect(token).not.toBe(oldToken);
    expect(Buffer.byteLength(token)).toBeLessThanOrEqual(64);
    const callback = (payload: string, generation = 1, sender = 'alice') => message('', generation, sender,
      [{ type: 'action', data: { payload } }]);
    expect(coordinator.resolveClaim(callback('yes'))).toBe(false);
    expect(coordinator.resolveClaim(callback('other-feature:yes'))).toBe(false);
    expect(coordinator.resolveClaim(callback(oldToken))).toBe(false);
    expect(coordinator.resolveClaim(callback(token, 2))).toBe(false);
    expect(coordinator.resolveClaim(callback(token, 1, 'bob'))).toBe(false);
    expect(coordinator.resolveClaim(new RuntimeMessage(
      {
        conversation: { ...conversation, threadId: 'other' },
        content: '',
        sender: { id: 'alice' },
        metadata: {},
        segments: [{ type: 'action', data: { payload: token } }],
      },
      { generation: 1, reply: async () => ({ status: 'sent' }) },
    ))).toBe(false);
    expect(coordinator.hasPendingAnswer(conversation, 'alice', 1, { content: '', segments: callback(oldToken).segments })).toBe(false);
    expect(coordinator.resolveClaim(callback(token))).toBe(true);
    await expect(first).resolves.toMatchObject({ name: 'UserInteractionSupersededError' });
    await expect(second).resolves.toBe(true);
    expect(coordinator.resolveClaim(callback(token))).toBe(false);
    expect(prompts).toHaveLength(2);
  });

  it('does not reactivate a stopped Root claim when its in-flight send completes', async () => {
    const coordinator = new RuntimeInteractionCoordinator();
    const root = rootPluginId();
    const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test',
      packageRoot: '/test', children: [] }]]), config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map() };
    const store = new SnapshotStore(state);
    const lease = store.acquire();
    const sending = deferred<DeliveryReceipt>();
    const source = new RuntimeMessage(
      { conversation: conversation, content: 'start', sender: { id: 'alice' }, metadata: {} },
      {
        generation: 0,
        reply: () => sending.promise,
        snapshot: lease.value,
        signal: lease.stopSignal,
      },
    );
    const answer = coordinator.createForMessage(source)!.ask({ type: 'text', title: '姓名', default: 'no' }).catch(error => error);
    const closing = store.close();
    expect(coordinator.hasPendingAnswer(conversation, 'alice', 0)).toBe(false);
    expect(coordinator.resolveClaim(message('old input', 0))).toBe(false);
    sending.resolve({ status: 'sent' });
    await expect(answer).resolves.toMatchObject({ name: 'AbortError' });
    expect(coordinator.hasPendingAnswer(conversation, 'alice', 0)).toBe(false);
    lease.release();
    await closing;
  });
});
