import { describe, expect, it } from 'vitest';
import {
  MemoryConversationEventStore,
  DatabaseConversationEventStore,
  isMediaRef,
  isDeliveryReceipt,
  supportsEndpointOperation,
  messageRefKey,
  type ConversationEvent,
  type DeliveryReceipt,
  type ConversationEventStore,
  type ConversationRef,
} from '../src/index.js';

class FakeModel {
  rows: Record<string, unknown>[] = [];
  constructor(private readonly rejectNul = false) {}

  private assertPostgresTextSafe(value: unknown): void {
    if (!this.rejectNul) return;
    if (typeof value === 'string' && value.includes('\0')) {
      throw new Error('invalid byte sequence for encoding "UTF8": 0x00');
    }
    if (Array.isArray(value)) {
      for (const entry of value) this.assertPostgresTextSafe(entry);
      return;
    }
    if (value && typeof value === 'object') {
      for (const entry of Object.values(value as Record<string, unknown>)) {
        this.assertPostgresTextSafe(entry);
      }
    }
  }

  select(...fields: string[]) {
    let rows = this.rows;
    const chain = {
      where: (query: Record<string, unknown>) => {
        this.assertPostgresTextSafe(query);
        const matches = (row: Record<string, unknown>, value: Record<string, unknown>): boolean => Object.entries(value).every(([key, expected]) => {
          if (key === '$or') return (expected as Record<string, unknown>[]).some(part => matches(row, part));
          if (key === '$and') return (expected as Record<string, unknown>[]).every(part => matches(row, part));
          if (expected && typeof expected === 'object') {
            const range = expected as { $gt?: number; $lte?: number; $lt?: number; $in?: unknown[]; $ne?: unknown };
            if (range.$gt !== undefined && Number(row[key]) <= range.$gt) return false;
            if (range.$lte !== undefined && Number(row[key]) > range.$lte) return false;
            if (range.$lt !== undefined && Number(row[key]) >= range.$lt) return false;
            if (range.$in !== undefined && !range.$in.includes(row[key])) return false;
            if ('$ne' in range && row[key] === range.$ne) return false;
            return true;
          }
          return expected === null ? row[key] == null : row[key] === expected;
        });
        rows = rows.filter(row => matches(row, query));
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
    this.assertPostgresTextSafe(row);
    const unique = String(row.event_id ?? row.cursor_key ?? '');
    if (this.rows.some((entry) => String(entry.event_id ?? entry.cursor_key ?? '') === unique)) throw new Error('unique');
    this.rows.push({ id: this.rows.length + 1, ...row });
  }
  update(patch: Record<string, unknown>) {
    return { where: (query: Record<string, unknown>) => {
      this.assertPostgresTextSafe(patch);
      this.assertPostgresTextSafe(query);
      for (const row of this.rows) if (Object.entries(query).every(([key, value]) => {
        if (value && typeof value === 'object' && '$lte' in value) {
          return Number(row[key]) <= Number((value as { $lte: number }).$lte);
        }
        return row[key] === value;
      })) Object.assign(row, patch);
    } };
  }
}

describe.each(['memory', 'database'] as const)('versioned conversation messages (%s)', kind => {
  const conversation: ConversationRef = { endpoint: { id: 'sandbox~main', adapter: 'sandbox' }, kind: 'group', id: 'room' };
  function fixture() {
    const events = new FakeModel(true);
    const store: ConversationEventStore = kind === 'memory' ? new MemoryConversationEventStore()
      : new DatabaseConversationEventStore(events as never, new FakeModel(true) as never);
    const created = (id: string, body: string): ConversationEvent => ({ eventId: `created:${id}`, type: 'message.created', conversation, timestamp: 1,
      message: { ref: { conversation, id }, timestamp: 1, segments: [{ type: 'text', data: { text: body } }] } });
    const updated = (id: string, revision: number, body: string): ConversationEvent => ({ eventId: `updated:${id}:${revision}`, type: 'message.updated', conversation, timestamp: revision + 1,
      message: { ref: { conversation, id }, timestamp: 1, revision, segments: [{ type: 'text', data: { text: body } }] } });
    return { events, store, created, updated };
  }

  it('projects the greatest confirmed revision, preserves original identity, and retains every event', async () => {
    const f = fixture();
    await f.store.append(f.created('a', 'initial'));
    await f.store.append(f.updated('a', 3, 'latest'));
    await f.store.append(f.updated('a', 1, 'late stale update'));
    const value = await f.store.getMessage({ conversation, id: 'a' });
    expect(value).toMatchObject({ revision: 3, timestamp: 1, segments: [{ type: 'text', data: { text: 'latest' } }] });
    expect(await f.store.listBetween(conversation, 0, 10, 10)).toHaveLength(3);
    expect(await f.store.append(f.updated('a', 3, 'latest'))).toMatchObject({ appended: false });
  });

  it('keeps recall dominant even when a newer update arrives afterwards', async () => {
    const f = fixture();
    await f.store.append(f.created('a', 'initial'));
    await f.store.append(f.updated('a', 1, 'visible before recall'));
    await f.store.append({ eventId: 'recall:a', type: 'message.recalled', conversation, timestamp: 4, message: { conversation, id: 'a' } });
    await f.store.append(f.updated('a', 2, 'must not resurrect'));
    expect(await f.store.getMessage({ conversation, id: 'a' })).toMatchObject({ recalled: true, revision: 1,
      segments: [{ type: 'text', data: { text: 'visible before recall' } }] });
  });

  it('pages message entities by creation sequence without updates displacing older messages', async () => {
    const f = fixture();
    await f.store.append(f.created('a', 'first'));
    const b = await f.store.append(f.created('b', 'second'));
    for (let revision = 1; revision <= 60; revision++) await f.store.append(f.updated('b', revision, `second v${revision}`));
    await f.store.append(f.created('c', 'third'));
    const latest = await f.store.listMessages!(conversation, undefined, 2);
    expect(latest.map(row => row.message.ref.id)).toEqual(['b', 'c']);
    expect(latest[0]).toMatchObject({ sequence: b.sequence, message: { revision: 60 } });
    const earlier = await f.store.listMessages!(conversation, latest[0]!.sequence, 2);
    expect(earlier.map(row => row.message.ref.id)).toEqual(['a']);
    expect(earlier[0]!.message.segments).toEqual([{ type: 'text', data: { text: 'first' } }]);
  });

  it('does not create a historical message from an update alone or leak another conversation', async () => {
    const f = fixture();
    await f.store.append(f.updated('a', 2, 'orphan update'));
    expect(await f.store.getMessage({ conversation, id: 'a' })).toBeUndefined();
    expect(await f.store.listMessages!(conversation, undefined, 50)).toEqual([]);
    await f.store.append(f.created('a', 'initial'));
    expect(await f.store.getMessage({ conversation, id: 'a' })).toMatchObject({ revision: 2 });
    expect(await f.store.listMessages!({ ...conversation, id: 'different-room' }, undefined, 50)).toEqual([]);
  });

  it('retains recalls recorded before message indexing without legacy notices exhausting a page', async () => {
    const f = fixture();
    await f.store.append(f.created('a', 'first'));
    await f.store.append({ eventId: 'recall:a', type: 'message.recalled', conversation, timestamp: 2, message: { conversation, id: 'a' } });
    await f.store.append(f.created('b', 'second'));
    await f.store.append({ eventId: 'notice', type: 'member.joined', conversation, timestamp: 3, member: { id: 'person' } });
    if (kind === 'database') for (const row of f.events.rows) {
      row.event_type = null;
      if (JSON.parse(String(row.event_json)).type === 'message.recalled') row.message_key = '';
    }
    const page = await f.store.listMessages!(conversation, undefined, 2);
    expect(page.map(row => row.message.ref.id)).toEqual(['a', 'b']);
    expect(page[0]!.message).toMatchObject({ recalled: true });
    expect(await f.store.getMessage({ conversation, id: 'a' })).toMatchObject({ recalled: true });
  });
});

describe('@zhin.js/im-contract', () => {
  it('owns the canonical media guard without depending on Core', () => {
    expect(isMediaRef({ kind: 'url', value: 'https://example.com/a.png' })).toBe(true);
    expect(isMediaRef({ kind: 'unknown', value: 'x' })).toBe(false);
    expect(isMediaRef({ kind: 'path', value: '/tmp/a', size: 'large' })).toBe(false);
  });

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
    expect(await store.listBetween(conversation, 0, Number.MAX_SAFE_INTEGER, 10)).toEqual([
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
    expect(await store.listBetween(conversation, 0, Number.MAX_SAFE_INTEGER, 10)).toEqual([{ sequence: 1, event }]);
    await store.commitCursor('agent:u1', conversation, 1);
    expect(await store.getCursor('agent:u1', conversation)).toBe(1);
    await store.commitCursor('agent:u1', conversation, 2);
    expect(await store.getCursor('agent:u1', conversation)).toBe(2);
    await expect(store.commitCursor('agent:u1', conversation, 0)).rejects.toThrow(/backwards/);
  });

  it('encodes every durable lookup key for PostgreSQL text columns', async () => {
    const events = new FakeModel(true);
    const cursors = new FakeModel(true);
    const store = new DatabaseConversationEventStore(events as never, cursors as never);
    const conversation = { endpoint: { id: 'main', adapter: 'icqq' }, kind: 'group' as const, id: 'g1' };
    const ref = { conversation, id: 'm1' };
    const event: ConversationEvent = {
      eventId: `message:${messageRefKey(ref)}`,
      conversation,
      timestamp: 10,
      type: 'message.created',
      message: {
        ref,
        actor: { id: 'u1' },
        segments: [{ type: 'text', data: { text: 'hello' } }],
        timestamp: 10,
      },
    };

    await expect(store.append(event)).resolves.toEqual({ appended: true, sequence: 1 });
    await expect(store.getMessage(ref)).resolves.toEqual(event.message);
    await expect(store.listBetween(conversation, 0, 1, 10)).resolves.toHaveLength(1);
    await expect(store.commitCursor('agent:u1', conversation, 1)).resolves.toBeUndefined();
    await expect(store.getCursor('agent:u1', conversation)).resolves.toBe(1);

    for (const row of [...events.rows, ...cursors.rows]) {
      for (const key of ['event_id', 'conversation_key', 'message_key', 'cursor_key']) {
        if (typeof row[key] === 'string') expect(row[key]).not.toContain('\0');
      }
    }
    expect(events.rows[0]).toMatchObject({
      event_id: 'k1:message:icqq%00main%00group%00g1%00%00%00%00m1',
      conversation_key: 'k1:icqq%00main%00group%00g1%00%00%00',
      message_key: 'k1:icqq%00main%00group%00g1%00%00%00%00m1',
    });
    expect(cursors.rows[0]).toMatchObject({
      cursor_key: 'k1:agent:u1%00icqq%00main%00group%00g1%00%00%00',
    });
  });

  it('continues reading and updating legacy unencoded durable keys', async () => {
    const events = new FakeModel();
    const cursors = new FakeModel();
    const store = new DatabaseConversationEventStore(events as never, cursors as never);
    const conversation = { endpoint: { id: 'main', adapter: 'icqq' }, kind: 'group' as const, id: 'g1' };
    const ref = { conversation, id: 'm1' };
    const event: ConversationEvent = {
      eventId: `message:${messageRefKey(ref)}`,
      conversation,
      timestamp: 10,
      type: 'message.created',
      message: { ref, actor: { id: 'u1' }, segments: [], timestamp: 10 },
    };
    events.rows.push({
      id: 7,
      event_id: event.eventId,
      conversation_key: `${conversation.endpoint.adapter}\0${conversation.endpoint.id}\0group\0g1\0\0\0`,
      message_key: messageRefKey(ref),
      event_json: JSON.stringify(event),
      time: 10,
    });
    cursors.rows.push({
      id: 1,
      cursor_key: `agent:u1\0${conversation.endpoint.adapter}\0${conversation.endpoint.id}\0group\0g1\0\0\0`,
      sequence: 6,
    });

    await expect(store.append(event)).resolves.toEqual({ appended: false, sequence: 7 });
    await expect(store.getMessage(ref)).resolves.toEqual(event.message);
    await expect(store.listBetween(conversation, 0, 10, 10)).resolves.toEqual([{ sequence: 7, event }]);
    await expect(store.getCursor('agent:u1', conversation)).resolves.toBe(6);
    await store.commitCursor('agent:u1', conversation, 8);
    expect(cursors.rows[0]?.sequence).toBe(8);
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
