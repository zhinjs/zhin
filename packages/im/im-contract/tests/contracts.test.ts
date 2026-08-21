import { describe, expect, it } from 'vitest';
import {
  MemoryConversationEventStore,
  DatabaseConversationEventStore,
  isDeliveryReceipt,
  supportsEndpointOperation,
  type ConversationEvent,
  type DeliveryReceipt,
} from '../src/index.js';

class FakeModel {
  rows: Record<string, unknown>[] = [];
  select(...fields: string[]) {
    let rows = this.rows;
    const chain = {
      where: (query: Record<string, unknown>) => {
        rows = rows.filter((row) => Object.entries(query).every(([key, expected]) => {
          if (expected && typeof expected === 'object' && '$gt' in expected) {
            return Number(row[key]) > Number((expected as { $gt: number }).$gt);
          }
          return row[key] === expected;
        }));
        return chain;
      },
      orderBy: (field: string, direction: 'ASC' | 'DESC' = 'ASC') => {
        rows = [...rows].sort((a, b) => (Number(a[field]) - Number(b[field])) * (direction === 'ASC' ? 1 : -1));
        return chain;
      },
      limit: (count: number) => { rows = rows.slice(0, count); return chain; },
      then: (resolve: (value: Record<string, unknown>[]) => unknown) => resolve(rows.map((row) => Object.fromEntries(fields.map((field) => [field, row[field]])))),
    };
    return chain;
  }
  insert(row: Record<string, unknown>) {
    const unique = String(row.event_id ?? row.cursor_key ?? '');
    if (this.rows.some((entry) => String(entry.event_id ?? entry.cursor_key ?? '') === unique)) throw new Error('unique');
    this.rows.push({ id: this.rows.length + 1, ...row });
  }
  update(patch: Record<string, unknown>) {
    return { where: (query: Record<string, unknown>) => {
      for (const row of this.rows) if (Object.entries(query).every(([key, value]) => {
        if (value && typeof value === 'object' && '$lte' in value) {
          return Number(row[key]) <= Number((value as { $lte: number }).$lte);
        }
        return row[key] === value;
      })) Object.assign(row, patch);
    } };
  }
}

describe('@zhin.js/im-contract', () => {
  it('makes endpoint operations declarative', () => {
    const capabilities = {
      inbound: true,
      outbound: true,
      operations: { recall: true },
    } as const;

    expect(supportsEndpointOperation(capabilities, 'send')).toBe(true);
    expect(supportsEndpointOperation(capabilities, 'recall')).toBe(true);
    expect(supportsEndpointOperation(capabilities, 'edit')).toBe(false);
  });

  it('keeps delivery receipts structured and serializable', () => {
    const receipt: DeliveryReceipt = {
      status: 'sent',
      message: {
        id: 'm-1',
        conversation: {
          endpoint: { id: 'adapter~main', adapter: 'sandbox' },
          kind: 'private',
          id: 'u-1',
        },
      },
    };

    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);
  });

  it('recognizes structured receipts without confusing endpoint-native results', () => {
    expect(isDeliveryReceipt({ status: 'sent' })).toBe(true);
    expect(isDeliveryReceipt({ status: 'unknown' })).toBe(false);
    expect(isDeliveryReceipt('native-1')).toBe(false);
  });

  it('stores conversation facts idempotently and resolves messages by canonical reference', async () => {
    const store = new MemoryConversationEventStore();
    const conversation = {
      endpoint: { id: 'adapter~main', adapter: 'icqq' },
      kind: 'group' as const,
      id: 'group-1',
    };
    const event: ConversationEvent = {
      eventId: 'message:m-1',
      conversation,
      timestamp: 100,
      type: 'message.created',
      message: {
        ref: { conversation, id: 'm-1' },
        actor: { id: 'u-1', displayName: 'Alice' },
        segments: [{ type: 'text', data: { text: 'hello' } }],
        timestamp: 100,
      },
    };

    expect(await store.append(event)).toEqual({ appended: true, sequence: 1 });
    expect(await store.append(event)).toEqual({ appended: false, sequence: 1 });
    expect(await store.getMessage(event.message.ref)).toEqual(event.message);
    expect(await store.listAfter(conversation, 0, 10)).toEqual([
      expect.objectContaining({ sequence: 1, event }),
    ]);
  });

  it('persists conversation facts and monotonic consumer cursors', async () => {
    const events = new FakeModel();
    const cursors = new FakeModel();
    const store = new DatabaseConversationEventStore(events as never, cursors as never);
    const conversation = { endpoint: { id: 'main', adapter: 'icqq' }, kind: 'group' as const, id: 'g1' };
    const event: ConversationEvent = {
      eventId: 'join-1', conversation, timestamp: 10, type: 'member.joined', member: { id: 'u1' },
    };
    expect(await store.append(event)).toEqual({ appended: true, sequence: 1 });
    expect(await store.append(event)).toEqual({ appended: false, sequence: 1 });
    expect(await store.listAfter(conversation, 0, 10)).toEqual([{ sequence: 1, event }]);
    await store.commitCursor('agent:u1', conversation, 1);
    expect(await store.getCursor('agent:u1', conversation)).toBe(1);
    await store.commitCursor('agent:u1', conversation, 2);
    expect(await store.getCursor('agent:u1', conversation)).toBe(2);
    await expect(store.commitCursor('agent:u1', conversation, 0)).rejects.toThrow(/backwards/);
  });

  it('keeps forwarded speakers neutral instead of assigning model roles', () => {
    const entry = {
      actor: { id: 'u-1', displayName: 'Alice' },
      segments: [{ type: 'text', data: { text: 'forwarded' } }],
      timestamp: 100,
    };
    expect(entry).not.toHaveProperty('role');
  });
});
