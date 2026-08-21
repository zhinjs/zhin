import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DatabaseWorkroomCatalog,
  FileWorkroomCatalog,
} from '../../src/workroom/catalog.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('FileWorkroomCatalog', () => {
  it('persists across instances and revision-checks replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workroom-catalog-'));
    roots.push(root);
    const file = join(root, '.zhin', 'workroom-catalog.json');
    const first = new FileWorkroomCatalog(file);
    const empty = await first.read();
    const definitions = {
      alpha: {
        name: 'Alpha',
        members: [{ agent: 'zhin', role: 'orchestrator' as const }],
        conversation: { adapter: 'sandbox', endpoint: 'bot', kind: 'group' as const, id: 'a', agent: 'zhin' },
      },
    };
    const saved = await first.replace(definitions, empty.revision);
    expect((await new FileWorkroomCatalog(file).read()).definitions).toEqual(definitions);
    await expect(first.replace({}, empty.revision)).rejects.toThrow(/其他会话修改/u);
    expect(saved.revision).not.toBe(empty.revision);
  });

  it('uses canonical revisions and deeply freezes loaded definitions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workroom-catalog-'));
    roots.push(root);
    const leftFile = join(root, 'left', 'catalog.json');
    const rightFile = join(root, 'right', 'catalog.json');
    const alpha = definition('a');
    const beta = definition('b');
    const left = new FileWorkroomCatalog(leftFile);
    const right = new FileWorkroomCatalog(rightFile);

    const leftSaved = await left.replace({ alpha, beta }, (await left.read()).revision);
    const rightSaved = await right.replace({ beta, alpha }, (await right.read()).revision);

    expect(leftSaved.revision).toBe(rightSaved.revision);
    expect(Object.isFrozen(leftSaved)).toBe(true);
    expect(Object.isFrozen(leftSaved.definitions)).toBe(true);
    expect(Object.isFrozen(leftSaved.definitions.alpha?.members)).toBe(true);
  });

  it('allows only one cross-instance replacement for the same expected revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workroom-catalog-'));
    roots.push(root);
    const file = join(root, '.zhin', 'workroom-catalog.json');
    const first = new FileWorkroomCatalog(file);
    const second = new FileWorkroomCatalog(file);
    const expected = (await first.read()).revision;

    const results = await Promise.allSettled([
      first.replace({ alpha: definition('a') }, expected),
      second.replace({ beta: definition('b') }, expected),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const snapshot = await new FileWorkroomCatalog(file).read();
    expect(Object.keys(snapshot.definitions)).toHaveLength(1);
  });

  it('recovers and publishes a winner left pending by a crashed writer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workroom-catalog-'));
    roots.push(root);
    const file = join(root, '.zhin', 'workroom-catalog.json');
    const candidateFile = join(root, 'candidate', 'workroom-catalog.json');
    const catalog = new FileWorkroomCatalog(file);
    const expected = (await catalog.read()).revision;
    const candidateCatalog = new FileWorkroomCatalog(candidateFile);
    await candidateCatalog.replace(
      { beta: definition('b') },
      (await candidateCatalog.read()).revision,
    );
    await mkdir(join(root, '.zhin'), { recursive: true });
    await writeFile(
      `${file}.cas-${expected}`,
      await readFile(candidateFile, 'utf8'),
      'utf8',
    );

    await expect(catalog.replace({ alpha: definition('a') }, expected))
      .rejects.toThrow(/其他会话修改/u);
    const recovered = await catalog.read();
    expect(recovered.definitions).toEqual({ beta: definition('b') });
    await expect(catalog.replace({ alpha: definition('a') }, recovered.revision))
      .resolves.toMatchObject({ definitions: { alpha: definition('a') } });
  });

  it('fails closed on revision or schema corruption after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workroom-catalog-'));
    roots.push(root);
    const file = join(root, '.zhin', 'workroom-catalog.json');
    const catalog = new FileWorkroomCatalog(file);
    await catalog.replace({ alpha: definition('a') }, (await catalog.read()).revision);
    const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;

    await writeFile(file, JSON.stringify({ ...stored, revision: '0'.repeat(64) }), 'utf8');
    await expect(new FileWorkroomCatalog(file).read()).rejects.toThrow(/revision|digest/iu);

    await writeFile(file, JSON.stringify({
      version: 1,
      definitions: { alpha: { ...definition('a'), unexpected: true } },
    }), 'utf8');
    await expect(new FileWorkroomCatalog(file).read()).rejects.toThrow(/schema|field|invalid/iu);
  });

  it('enforces Project and collaboration-space invariants at the repository boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workroom-catalog-'));
    roots.push(root);
    const catalog = new FileWorkroomCatalog(join(root, '.zhin', 'workroom-catalog.json'));
    const expected = (await catalog.read()).revision;

    await expect(catalog.replace({
      alpha: {
        ...definition('a'),
        members: [{ agent: 'worker', role: 'executor' }],
      },
    }, expected)).rejects.toThrow(/orchestrator/iu);

    await expect(catalog.replace({
      alpha: definition('shared'),
      beta: definition('shared'),
    }, expected)).rejects.toThrow(/already owned|collaboration space/iu);
  });
});

describe('DatabaseWorkroomCatalog', () => {
  it('converges an exact lost-response retry and rejects payload drift', async () => {
    const rows: Record<string, unknown>[] = [];
    const select = () => ({
      where: async ({ id }: Record<string, unknown>) => rows.filter(row => row.id === id),
    });
    const database = {
      transaction: async <T>(operation: (transaction: any) => Promise<T>) => await operation({
        select: () => select(),
        insertMany: async (_table: string, inserted: Record<string, unknown>[]) => {
          rows.push(...inserted.map(row => ({ ...row })));
        },
        update: (_table: string, values: Record<string, unknown>) => ({
          where: async ({ id }: Record<string, unknown>) => {
            const row = rows.find(candidate => candidate.id === id);
            if (!row) return 0;
            Object.assign(row, values);
            return 1;
          },
        }),
      }, { isolationLevel: 'SERIALIZABLE' as const }),
    };
    const catalog = new DatabaseWorkroomCatalog(database, { select });
    const empty = await catalog.read();
    const saved = await catalog.replace({ alpha: definition('a') }, empty.revision);

    await expect(catalog.replace({ alpha: definition('a') }, empty.revision))
      .resolves.toEqual(saved);
    await expect(catalog.replace({ beta: definition('b') }, empty.revision))
      .rejects.toThrow(/其他会话修改/u);
  });
});

function definition(id: string) {
  return {
    name: `Project ${id}`,
    members: [{ agent: 'zhin', role: 'orchestrator' as const }],
    conversation: {
      adapter: 'sandbox',
      endpoint: 'bot',
      kind: 'group' as const,
      id,
      agent: 'zhin',
    },
  };
}
