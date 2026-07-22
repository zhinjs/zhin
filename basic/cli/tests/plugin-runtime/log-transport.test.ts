import { describe, expect, it } from 'vitest';
import { SYSTEM_LOG_TABLE, type DatabaseHost, type DatabaseHostModel } from '@zhin.js/plugin-runtime';
import {
  DEFAULT_SYSTEM_LOG_CONFIG,
  SystemLogDatabaseTransport,
  mapFormattedLevel,
} from '../../src/plugin-runtime/log-transport.js';

/** 内存假 DatabaseHost：支持 $lt / $in 操作符，覆盖 cleanup 查询路径。 */
function fakeDatabaseHost(started = true): {
  host: DatabaseHost;
  rows: Record<string, unknown>[];
} {
  const rows: Record<string, unknown>[] = [];
  let nextId = 1;
  const matchValue = (actual: unknown, expected: unknown): boolean => {
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      const ops = expected as Record<string, unknown>;
      if ('$lt' in ops) {
        const a = actual instanceof Date ? actual.getTime() : actual;
        const b = ops.$lt instanceof Date ? ops.$lt.getTime() : ops.$lt;
        return (a as number) < (b as number);
      }
      if ('$in' in ops) return (ops.$in as unknown[]).includes(actual);
    }
    return actual === expected;
  };
  const match = (row: Record<string, unknown>, query: Record<string, unknown>) =>
    Object.entries(query).every(([key, value]) => matchValue(row[key], value));
  const model: DatabaseHostModel = {
    insert: async (row) => {
      rows.push({ id: nextId++, ...row });
    },
    select: () => ({
      where: async (query) => rows.filter((row) => match(row, query)),
      then: (onfulfilled?: ((value: Record<string, unknown>[]) => unknown) | null) =>
        Promise.resolve(rows).then(onfulfilled),
    }),
    delete: () => ({
      where: async (query) => {
        const before = rows.length;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (match(rows[index]!, query)) rows.splice(index, 1);
        }
        return before - rows.length;
      },
    }),
    update: () => ({ where: async () => 0 }),
  };
  const host = {
    dialect: 'sqlite',
    started,
    define: () => undefined,
    tables: () => [SYSTEM_LOG_TABLE],
    models: { get: (name: string) => (name === SYSTEM_LOG_TABLE ? model : undefined) },
  } as unknown as DatabaseHost;
  return { host, rows };
}

/** 等 fire-and-forget insert 落定。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mapFormattedLevel', () => {
  it('maps DefaultFormatter 级别名到 info/warn/error/debug', () => {
    expect(mapFormattedLevel('DBG')).toBe('debug');
    expect(mapFormattedLevel('INF')).toBe('info');
    expect(mapFormattedLevel('WRN')).toBe('warn');
    expect(mapFormattedLevel('ERR')).toBe('error');
    expect(mapFormattedLevel('OFF')).toBeUndefined();
    expect(mapFormattedLevel('???')).toBeUndefined();
  });
});

describe('SystemLogDatabaseTransport', () => {
  it('host 未 started 时静默丢弃', async () => {
    const { host, rows } = fakeDatabaseHost(false);
    const transport = new SystemLogDatabaseTransport(host);
    transport.write('[07-22 02:03:44] [INF] [runtime]: hello');
    await flush();
    expect(rows).toHaveLength(0);
  });

  it('解析格式化行并落库（去 ANSI、source 取首段）', async () => {
    const { host, rows } = fakeDatabaseHost();
    const transport = new SystemLogDatabaseTransport(host);
    transport.write('\x1b[90m[07-22 02:03:44]\x1b[39m \x1b[33m[WRN]\x1b[39m [AgentHost:sub]: something \x1b[31mred\x1b[39m');
    transport.write('not a log line');
    await flush();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      level: 'warn',
      name: 'AgentHost:sub',
      message: 'something red',
      source: 'AgentHost',
    });
    expect(rows[0]!.timestamp).toBeInstanceOf(Date);
  });

  it('cleanup 按 maxDays 与 maxRecords 删除', async () => {
    const { host, rows } = fakeDatabaseHost();
    const transport = new SystemLogDatabaseTransport(host, {
      ...DEFAULT_SYSTEM_LOG_CONFIG,
      maxDays: 7,
      maxRecords: 2,
    });
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    rows.push(
      { id: 1, level: 'info', name: 'a', message: 'old', source: 'a', timestamp: old },
      { id: 2, level: 'info', name: 'a', message: 'r1', source: 'a', timestamp: new Date(Date.now() - 3000) },
      { id: 3, level: 'info', name: 'a', message: 'r2', source: 'a', timestamp: new Date(Date.now() - 2000) },
      { id: 4, level: 'info', name: 'a', message: 'r3', source: 'a', timestamp: new Date(Date.now() - 1000) },
    );
    await (transport as unknown as { cleanupOldLogs(): Promise<void> }).cleanupOldLogs();
    expect(rows.map((row) => row.message)).toEqual(['r2', 'r3']);
  });
});
