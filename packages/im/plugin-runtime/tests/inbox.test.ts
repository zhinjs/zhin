import { describe, expect, it } from 'vitest';
import type { DatabaseHostModel } from '../src/database-host.js';
import {
  defineInboxTables,
  INBOX_MESSAGE_DEFINITION,
  INBOX_NOTICE_DEFINITION,
  INBOX_REQUEST_DEFINITION,
  INBOX_TABLE_MESSAGE,
  INBOX_TABLE_NOTICE,
  INBOX_TABLE_REQUEST,
  insertInboxRow,
} from '../src/inbox.js';

function fakeHost(started = false) {
  const defined = new Map<string, Record<string, unknown>>();
  return {
    defined,
    get started() {
      return started;
    },
    define(name: string, definition: Record<string, unknown>) {
      defined.set(name, definition);
    },
    tables() {
      return [...defined.keys()];
    },
  };
}

describe('inbox table definitions', () => {
  it('message table matches the console reader columns', () => {
    expect(Object.keys(INBOX_MESSAGE_DEFINITION)).toEqual([
      'id',
      'adapter',
      'endpoint_id',
      'platform_message_id',
      'channel_id',
      'channel_type',
      'channel_name',
      'channel_parent_type',
      'channel_parent_id',
      'sender_id',
      'sender_name',
      'sender_payload',
      'content',
      'raw',
      'created_at',
    ]);
    expect(INBOX_MESSAGE_DEFINITION.id).toEqual({
      type: 'integer',
      primary: true,
      autoIncrement: true,
    });
  });

  it('request table carries resolved + consumed markers (legacy parity)', () => {
    for (const column of [
      'platform_request_id',
      'type',
      'scene_type',
      'scene_id',
      'sub_type',
      'actor_id',
      'actor_name',
      'comment',
      'created_at',
      'resolved',
      'resolved_at',
      'consumed',
      'consumed_at',
    ]) {
      expect(INBOX_REQUEST_DEFINITION).toHaveProperty(column);
    }
    expect(INBOX_REQUEST_DEFINITION.resolved).toMatchObject({ default: 0 });
    expect(INBOX_REQUEST_DEFINITION.consumed).toMatchObject({ default: 0 });
  });

  it('notice table carries target/payload + consumed marker', () => {
    for (const column of [
      'platform_notice_id',
      'type',
      'scene_type',
      'scene_id',
      'sub_type',
      'actor_id',
      'actor_name',
      'target_id',
      'target_name',
      'payload',
      'created_at',
      'consumed',
      'consumed_at',
    ]) {
      expect(INBOX_NOTICE_DEFINITION).toHaveProperty(column);
    }
  });
});

describe('defineInboxTables', () => {
  it('defines all three tables and is idempotent', () => {
    const host = fakeHost();
    defineInboxTables(host);
    expect(host.tables()).toEqual([
      INBOX_TABLE_MESSAGE,
      INBOX_TABLE_REQUEST,
      INBOX_TABLE_NOTICE,
    ]);
    expect(host.defined.get(INBOX_TABLE_REQUEST)).toBe(INBOX_REQUEST_DEFINITION);
    // 第二次调用不重复 define
    defineInboxTables(host);
    expect(host.tables()).toHaveLength(3);
  });

  it('skips tables that are already defined', () => {
    const host = fakeHost();
    host.define(INBOX_TABLE_MESSAGE, { custom: true });
    defineInboxTables(host);
    expect(host.defined.get(INBOX_TABLE_MESSAGE)).toEqual({ custom: true });
    expect(host.tables()).toHaveLength(3);
  });

  it('does nothing once the host has started', () => {
    const host = fakeHost(true);
    defineInboxTables(host);
    expect(host.tables()).toHaveLength(0);
  });
});

describe('insertInboxRow', () => {
  it('returns false when the model is missing', async () => {
    const host = { models: { get: () => undefined } };
    await expect(insertInboxRow(host, INBOX_TABLE_MESSAGE, { a: 1 })).resolves.toBe(false);
  });

  it('inserts through the model and returns true', async () => {
    const inserted: Record<string, unknown>[] = [];
    const model = {
      insert: async (row: Record<string, unknown>) => { inserted.push(row); },
    } as unknown as DatabaseHostModel;
    const host = {
      models: {
        get: (name: string) => (name === INBOX_TABLE_MESSAGE ? model : undefined),
      },
    };
    await expect(insertInboxRow(host, INBOX_TABLE_MESSAGE, { a: 1 })).resolves.toBe(true);
    expect(inserted).toEqual([{ a: 1 }]);
  });
});
