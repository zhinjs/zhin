import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonConfigDocument } from '../src/json-config-document.js';

it('admits only one of two concurrently committed transactions prepared from the same revision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-config-concurrent-')); const file = join(directory, 'config.json');
  try {
    await writeFile(file, '{"value":0}\n'); const document = new JsonConfigDocument(file); const snapshot = await document.read();
    const first = await document.prepare(snapshot, [{ op: 'set', path: ['value'], value: 1 }]);
    const second = await document.prepare(snapshot, [{ op: 'set', path: ['value'], value: 2 }]);
    const results = await Promise.allSettled([first.commit(), second.commit()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const winning = results[0].status === 'fulfilled' ? 1 : 2;
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ value: winning });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it('serializes same-transaction commit and rollback and lets the queue recover after conflict', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-config-concurrent-')); const file = join(directory, 'config.json');
  try {
    await writeFile(file, '{"value":0}\n'); const document = new JsonConfigDocument(file); const snapshot = await document.read();
    const first = await document.prepare(snapshot, [{ op: 'set', path: ['value'], value: 1 }]);
    await Promise.all([first.commit(), first.rollback()]);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ value: 0 });
    await expect(first.commit()).rejects.toThrow('rolled-back');
    const second = await document.prepare(await document.read(), [{ op: 'set', path: ['value'], value: 2 }]);
    await second.commit(); expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ value: 2 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
