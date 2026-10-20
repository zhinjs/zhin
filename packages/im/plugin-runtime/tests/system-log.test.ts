import { describe, expect, it } from 'vitest';
import type { DatabaseHostModel } from '../src/database-host.js';
import {
  defineSystemLogTable,
  insertSystemLogRow,
  SYSTEM_LOG_DEFINITION,
  SYSTEM_LOG_TABLE,
} from '../src/system-log.js';

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
    tables: () => [...defined.keys()],
  };
}

describe('defineSystemLogTable', () => {
  it('defines SystemLog table and is idempotent', () => {
    const host = fakeHost();
    defineSystemLogTable(host);
    expect(host.tables()).toEqual([SYSTEM_LOG_TABLE]);
    expect(host.defined.get(SYSTEM_LOG_TABLE)).toBe(SYSTEM_LOG_DEFINITION);
    defineSystemLogTable(host);
    expect(host.tables()).toHaveLength(1);
  });

  it('skips when already defined or host started', () => {
    const host = fakeHost();
    host.define(SYSTEM_LOG_TABLE, { custom: true });
    defineSystemLogTable(host);
    expect(host.defined.get(SYSTEM_LOG_TABLE)).toEqual({ custom: true });

    const started = fakeHost(true);
    defineSystemLogTable(started);
    expect(started.tables()).toHaveLength(0);
  });
});

describe('insertSystemLogRow', () => {
  it('returns false when the model is missing', async () => {
    const host = { models: { get: () => undefined } };
    await expect(insertSystemLogRow(host, { a: 1 })).resolves.toBe(false);
  });

  it('inserts through the model and returns true', async () => {
    const inserted: Record<string, unknown>[] = [];
    const model = {
      insert: async (row: Record<string, unknown>) => { inserted.push(row); },
    } as unknown as DatabaseHostModel;
    const host = {
      models: {
        get: (name: string) => (name === SYSTEM_LOG_TABLE ? model : undefined),
      },
    };
    await expect(insertSystemLogRow(host, { a: 1 })).resolves.toBe(true);
    expect(inserted).toEqual([{ a: 1 }]);
  });
});
