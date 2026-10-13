import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonConfigDocument } from '../src/json-config-document.js';
import { withConfigFileLock } from '../src/config-file-lock.js';
import { writeFileSync, unlinkSync } from 'node:fs';

it.each(['replaced', 'released'] as const)('rechecks an exited writer marker that was %s before diagnosing abandonment', async mode => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-config-probe-race-'));
  const file = join(directory, 'config.json'), lock = join(directory, '.config.json.zhin-lock');
  const oldPid = 999999;
  const probe = vi.spyOn(process, 'kill').mockImplementation(pid => {
    if (pid === oldPid) {
      if (mode === 'released') unlinkSync(lock);
      else writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce: 'live-successor' }));
      throw Object.assign(new Error('old writer exited'), { code: 'ESRCH' });
    }
    expect(pid).toBe(process.pid);
    unlinkSync(lock); // The live successor finishes before the next acquisition.
    return true;
  });
  try {
    await writeFile(lock, JSON.stringify({ pid: oldPid, nonce: 'old-writer' }));
    const operation = vi.fn(async () => 'committed');
    await expect(withConfigFileLock(file, operation)).resolves.toBe('committed');
    expect(operation).toHaveBeenCalledOnce();
    await expect(readFile(lock, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { probe.mockRestore(); await rm(directory, { recursive: true, force: true }); }
});

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

it('serializes independent document instances so the losing revision cannot overwrite the winner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-config-independent-'));
  const file = join(directory, 'config.json');
  try {
    await writeFile(file, '{"left":0,"right":0}\n');
    const a = new JsonConfigDocument(file), b = new JsonConfigDocument(file);
    const [snapshotA, snapshotB] = await Promise.all([a.read(), b.read()]);
    const [first, second] = await Promise.all([
      a.prepare(snapshotA, [{ op: 'set', path: ['left'], value: 1 }]),
      b.prepare(snapshotB, [{ op: 'set', path: ['right'], value: 1 }]),
    ]);
    const results = await Promise.allSettled([first.commit(), second.commit()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.name).toBe('ConfigDocumentConflictError');
    const winner = results[0]!.status === 'fulfilled' ? { left: 1, right: 0 } : { left: 0, right: 1 };
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(winner);
    expect(await readdir(directory)).toEqual(['config.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects an abandoned cross-process lock without stealing it or changing the config', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-config-abandoned-'));
  const file = join(directory, 'config.json');
  try {
    await writeFile(file, '{"value":0}\n');
    const document = new JsonConfigDocument(file);
    const prepared = await document.prepare(await document.read(), [{ op: 'set', path: ['value'], value: 1 }]);
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    const pid = child.pid!;
    await new Promise<void>((resolve, reject) => { child.once('exit', () => resolve()); child.once('error', reject); });
    const lock = join(directory, '.config.json.zhin-lock');
    const marker = JSON.stringify({ pid, nonce: 'abandoned' });
    await writeFile(lock, marker);
    await expect(prepared.commit()).rejects.toThrow('Previous configuration writer');
    expect(await readFile(lock, 'utf8')).toBe(marker);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ value: 0 });
    await rm(lock);
    await prepared.commit();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ value: 1 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('preserves lock I/O failures instead of treating them as ordinary contention', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-config-lock-io-'));
  const file = join(directory, 'config.json');
  try {
    await writeFile(file, '{"value":0}\n');
    const document = new JsonConfigDocument(file);
    const prepared = await document.prepare(await document.read(), [{ op: 'set', path: ['value'], value: 1 }]);
    await mkdir(join(directory, '.config.json.zhin-lock'));
    await expect(prepared.commit()).rejects.toMatchObject({ code: 'EISDIR' });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ value: 0 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('admits only one writer across real independent Node processes prepared from the same revision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-config-processes-'));
  const file = join(directory, 'config.json');
  const children: ReturnType<typeof spawn>[] = [];
  try {
    await writeFile(file, '{"left":0,"right":0}\n');
    const launch = (field: string) => {
      const code = `
        import { JsonConfigDocument } from ${JSON.stringify(new URL('../src/json-config-document.ts', import.meta.url).href)};
        const doc = new JsonConfigDocument(${JSON.stringify(file)});
        const txn = await doc.prepare(await doc.read(), [{op:'set',path:[${JSON.stringify(field)}],value:1}]);
        console.log('READY');
        process.stdin.once('data', async () => {
          try { await txn.commit(); console.log(JSON.stringify({status:'committed'})); }
          catch(error) { console.log(JSON.stringify({status:'rejected',name:error.name})); }
          process.stdin.destroy();
        });
      `;
      const child = spawn(process.execPath, ['--import', 'tsx', '--conditions=development', '--input-type=module', '-e', code], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
      children.push(child);
      let output = '', stderr = '';
      let ready!: () => void;
      const prepared = new Promise<void>(resolve => { ready = resolve; });
      child.stdout!.on('data', chunk => { output += String(chunk); if (output.includes('READY\n')) ready(); });
      child.stderr!.on('data', chunk => { stderr += String(chunk); });
      const result = new Promise<{ status: string; name?: string }>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => {
          if (code !== 0) { reject(new Error(`Child failed (${code}): ${stderr}`)); return; }
          const last = output.trim().split('\n').at(-1)!;
          try { resolve(JSON.parse(last)); } catch { reject(new Error(`Child produced no result: ${stderr}`)); }
        });
      });
      return { child, prepared: Promise.race([prepared, result.then(() => { throw new Error('Child exited before preparation'); })]), result };
    };
    const a = launch('left'), b = launch('right');
    await Promise.all([a.prepared, b.prepared]);
    a.child.stdin!.write('commit\n'); b.child.stdin!.write('commit\n');
    const results = await Promise.all([a.result, b.result]);
    expect(results.filter(result => result.status === 'committed')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ name: 'ConfigDocumentConflictError' });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(results[0]!.status === 'committed' ? { left: 1, right: 0 } : { left: 0, right: 1 });
    expect(await readdir(directory)).toEqual(['config.json']);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps completed commit and unused rollback idempotent without touching a different writer lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-config-idempotent-'));
  const file = join(directory, 'config.json');
  try {
    await writeFile(file, '{"value":0}\n');
    const document = new JsonConfigDocument(file);
    const transaction = await document.prepare(await document.read(), [{ op: 'set', path: ['value'], value: 1 }]);
    const committed = await transaction.commit();
    const unused = await document.prepare(await document.read(), [{ op: 'set', path: ['value'], value: 2 }]);
    await mkdir(join(directory, '.config.json.zhin-lock'));
    expect(await transaction.commit()).toBe(committed);
    await unused.rollback();
    await unused.rollback();
    await expect(unused.commit()).rejects.toThrow('rolled-back');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ value: 1 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('preserves a replacement lock and both errors when mutation and cleanup fail together', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-config-lock-ownership-'));
  const file = join(directory, 'config.json'), lock = join(directory, '.config.json.zhin-lock');
  const failure = new Error('original mutation failure');
  const replacement = JSON.stringify({ pid: process.pid, nonce: 'different-writer' });
  try {
    const result = await withConfigFileLock(file, async () => {
      await writeFile(lock, replacement);
      throw failure;
    }).catch(error => error);
    expect(result).toBeInstanceOf(AggregateError);
    expect(result.cause).toBe(failure);
    expect(result.errors[0]).toBe(failure);
    expect(result.errors[1].message).toContain('ownership changed');
    expect(await readFile(lock, 'utf8')).toBe(replacement);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
