import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';

describe('DatabaseHost', () => {
  it('tracks defined table names via tables()', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-db-host-'));
    const host = createDatabaseHost({ dialect: 'sqlite', filename: join(dir, 't.sqlite') });
    expect(host.tables()).toEqual([]);
    host.define('alpha', { id: { type: 'integer' } });
    host.define('beta', { id: { type: 'integer' } });
    expect(host.tables()).toEqual(['alpha', 'beta']);
    await rm(dir, { recursive: true, force: true });
  });

  it('defines tables, starts sqlite, and persists rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-db-host-'));
    const filename = join(dir, 'test.sqlite');
    const host = createDatabaseHost({ dialect: 'sqlite', filename });
    host.define('smoke', {
      name: { type: 'text', nullable: false },
      value: { type: 'text', default: '' },
    });
    expect(host.started).toBe(false);
    await host.start();
    expect(host.started).toBe(true);
    const model = host.models.get('smoke');
    expect(model).toBeDefined();
    await model!.insert({ name: 'a', value: '1' });
    const rows = await model!.select().where({ name: 'a' });
    expect(rows).toEqual([expect.objectContaining({ name: 'a', value: '1' })]);
    await host.stop();
    await rm(dir, { recursive: true, force: true });
  });
});
