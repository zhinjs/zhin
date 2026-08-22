import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DurableFileStore,
  type DurableFileSystem,
} from '../../src/workroom/durable-file-store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('DurableFileStore', () => {
  it('requires a pre-existing durable parent and syncs it after creating the leaf', async () => {
    const root = temporaryRoot('parent');
    await mkdir(root);
    const leaf = join(root, 'durable');
    const trace: string[] = [];
    const store = new DurableFileStore(leaf, tracingFileSystem(trace));

    await store.ensureDurableLeaf('test repository');

    expect(trace).toEqual([
      `mkdir:${leaf}`,
      `open:r:${dirname(leaf)}`,
      `sync:r:${dirname(leaf)}`,
      `close:r:${dirname(leaf)}`,
    ]);
    await expect(new DurableFileStore(join(root, 'missing', 'leaf'))
      .ensureDurableLeaf('test repository'))
      .rejects.toThrow(/pre-existing durable parent/iu);
  });

  it('publishes create-only content after file fsync and confirms with leaf fsync', async () => {
    const root = temporaryRoot('publish');
    await mkdir(root);
    const leaf = join(root, 'durable');
    const trace: string[] = [];
    const store = new DurableFileStore(leaf, tracingFileSystem(trace));
    await store.ensureDurableLeaf('test repository');
    trace.length = 0;
    const target = join(leaf, 'fact.json');

    const result = await store.publishCreateOnly({
      target,
      content: '{"value":1}',
      createdValue: 'created',
      onConflict: async () => 'replayed',
    });

    expect(result).toEqual({ status: 'created', value: 'created' });
    expect(await readFile(target, 'utf8')).toBe('{"value":1}');
    expect(trace.findIndex(entry => entry.startsWith('sync:wx:')))
      .toBeLessThan(trace.indexOf(`link:${target}`));
    expect(trace.indexOf(`link:${target}`)).toBeLessThan(trace.indexOf(`sync:r:${leaf}`));
    expect((await readdir(leaf)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('replays an existing winner and re-syncs the leaf after a lost directory fsync', async () => {
    const root = temporaryRoot('lost-fsync');
    await mkdir(root);
    const leaf = join(root, 'durable');
    let failLeafSync = true;
    const fileSystem = tracingFileSystem([], async path => {
      if (path === leaf && failLeafSync) {
        failLeafSync = false;
        throw new Error('injected leaf fsync failure');
      }
    });
    const first = new DurableFileStore(leaf, fileSystem);
    await first.ensureDurableLeaf('test repository');
    const target = join(leaf, 'fact.json');
    await expect(first.publishCreateOnly({
      target,
      content: '{"value":1}',
      createdValue: 'created',
      onConflict: async () => 'replayed',
    })).rejects.toThrow('injected leaf fsync failure');

    let observedWinner = '';
    const retried = await new DurableFileStore(leaf, fileSystem).publishCreateOnly({
      target,
      content: '{"value":1}',
      createdValue: 'created',
      onConflict: async () => {
        observedWinner = await readFile(target, 'utf8');
        return 'replayed';
      },
    });

    expect(retried).toEqual({ status: 'replayed', value: 'replayed' });
    expect(observedWinner).toBe('{"value":1}');
    expect((await readdir(leaf)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });
});

function temporaryRoot(label: string): string {
  const root = join(tmpdir(), `durable-file-store-${label}-${crypto.randomUUID()}`);
  roots.push(root);
  return root;
}

function tracingFileSystem(
  trace: string[],
  onSync: (path: string) => Promise<void> = async () => undefined,
): DurableFileSystem {
  return {
    mkdir: async path => {
      trace.push(`mkdir:${path}`);
      await mkdir(path);
    },
    open: async (path, flags) => {
      trace.push(`open:${flags}:${path}`);
      const handle = await open(path, flags);
      return {
        writeFile: async (value, encoding) => { await handle.writeFile(value, encoding); },
        sync: async () => {
          trace.push(`sync:${flags}:${path}`);
          await onSync(path);
          await handle.sync();
        },
        close: async () => {
          trace.push(`close:${flags}:${path}`);
          await handle.close();
        },
      };
    },
    link: async (existingPath, newPath) => {
      trace.push(`link:${newPath}`);
      await link(existingPath, newPath);
    },
    unlink: async path => { await unlink(path); },
  };
}
