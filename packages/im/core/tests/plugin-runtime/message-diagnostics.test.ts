import { RuntimeMessageDiagnostics } from '../../src/plugin-runtime/im/message-diagnostics.js';
import type { ConversationRef } from '@zhin.js/im-contract';

const conversation: ConversationRef = { endpoint: { id: 'endpoint-1', adapter: 'telegram' }, kind: 'channel', id: 'room',
  parent: { kind: 'channel', id: 'guild' }, threadId: 'thread-1' };

describe('message diagnostics projection', () => {
  it('returns immutable point-in-time snapshots and filters exact identity before limit', async () => {
    const store = new RuntimeMessageDiagnostics();
    await store.run(async () => {
      store.begin(1, conversation, 'message');
      const before = store.list()[0];
      expect(before.status).toBe('processing');
      store.step('prefix', 'matched');
      store.dispatch({ matched: true, command: 'hello', status: 'executed' });
      expect(before.steps).toHaveLength(1);
    });
    await store.run(async () => store.begin(2, { ...conversation, threadId: 'thread-2' }, 'message'));
    await store.run(async () => store.begin(2, conversation, 'newer'));
    const record = store.list({ conversation, messageId: 'message', limit: 1 })[0];
    expect(record).toMatchObject({ generation: 1, status: 'completed', command: 'hello', dispatchStatus: 'executed' });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.conversation.endpoint)).toBe(true);
    expect(Object.isFrozen(record.conversation.parent)).toBe(true);
    expect(Object.isFrozen(record.steps[0])).toBe(true);
    expect(store.get(record.id)).toEqual(record);
    expect(store.list({ conversation: { ...conversation, endpoint: { ...conversation.endpoint, id: 'other' } } })).toEqual([]);
  });

  it('is capacity and TTL bounded without retaining a generation lease', async () => {
    let now = 100;
    const store = new RuntimeMessageDiagnostics({ now: () => now, capacity: 2, ttlMs: 10 });
    for (let n = 0; n < 3; n++) await store.run(async () => store.begin(n, conversation));
    expect(store.list().map(item => item.generation)).toEqual([2, 1]);
    const id = store.list()[0].id;
    now = 111;
    expect(store.get(id)).toBeUndefined();
    expect(store.list()).toEqual([]);
  });

  it('isolates concurrent operations and ignores late or wrong-generation delivery observations', async () => {
    const store = new RuntimeMessageDiagnostics();
    let resume!: () => void;
    let releaseLate!: () => void;
    let lateTask!: Promise<void>;
    const lateGate = new Promise<void>(resolve => { releaseLate = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const first = store.run(async () => {
      store.begin(1, conversation, 'first');
      await gate;
      store.delivery(1, conversation, { status: 'sent' });
      lateTask = (async () => {
        await lateGate;
        // This continuation inherits the old ALS context, but its operation has ended.
        store.delivery(1, conversation, { status: 'rejected' });
      })();
    });
    await store.run(async () => {
      store.begin(2, conversation, 'second');
      store.delivery(1, conversation, { status: 'sent' });
      store.delivery(2, conversation, { status: 'failed', failure: { code: 'endpoint_timeout', message: 'SECRET', deliveryUnknown: true } });
    });
    resume();
    await first;
    releaseLate();
    await lateTask;
    expect(store.list({ messageId: 'first' })[0].deliveries).toEqual([{ conversation, status: 'sent' }]);
    expect(store.list({ messageId: 'second' })[0].deliveries).toEqual([
      { conversation, status: 'failed', failureCode: 'endpoint_timeout', deliveryUnknown: true },
    ]);
    expect(JSON.stringify(store.list())).not.toContain('SECRET');
  });

  it('records failures without swallowing or serializing the original exception', async () => {
    const store = new RuntimeMessageDiagnostics();
    const error = new Error('private key and body');
    await expect(store.run(async () => {
      store.begin(1, conversation);
      throw error;
    })).rejects.toBe(error);
    expect(store.list()[0]).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(store.list())).not.toContain(error.message);
  });

  it('does not retain unknown adapter error strings and bounds the evidence lists', async () => {
    const store = new RuntimeMessageDiagnostics();
    await store.run(async () => {
      store.begin(1, conversation);
      for (let n = 0; n < 50; n++) store.delivery(1, conversation, {
        status: 'failed', failure: { code: 'PRIVATEKEY123', message: 'SECRET', deliveryUnknown: true },
      });
    });
    const record = store.list()[0];
    expect(record.deliveries).toHaveLength(32);
    expect(record.truncated).toBe(true);
    expect(record.steps.length).toBeLessThanOrEqual(32);
    expect(record.deliveries[0].failureCode).toBe('delivery_failed');
    expect(JSON.stringify(record)).not.toMatch(/PRIVATEKEY123|SECRET/);
  });
});
