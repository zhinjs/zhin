import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DatabaseHost, DatabaseHostTransaction } from '@zhin.js/plugin-runtime';
import type { ProviderGraph, ProviderCredentialRecord } from '@zhin.js/ai/provider';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import {
  DatabaseInferenceRepository,
  readStoredInferenceGraph,
} from '../../../src/plugin-runtime/inference/repository.js';

const rootId = '/synthetic-host';
function graph(revision: number, root = rootId): ProviderGraph {
  return {
    rootId: root,
    revision,
    services: {
      service: {
        id: 'service',
        rootId: root,
        ownerId: 'host',
        revision: 1,
        driver: { id: 'synthetic', owner: 'root/driver', contractVersion: '1' },
        options: {},
        models: {},
      },
    },
    accounts: {
      account: {
        id: 'account',
        rootId: root,
        ownerId: 'host',
        revision: 1,
        serviceId: 'service',
        incarnation: 'first-incarnation',
        authentication: { method: 'oauth' },
      },
    },
    profiles: {},
    purposes: { defaults: {} },
  };
}
const normalizeGraph = (value: unknown) => structuredClone(value) as ProviderGraph;
const credential = (revision = 1): ProviderCredentialRecord => ({
  rootId,
  accountId: 'account',
  incarnation: 'first-incarnation',
  revision,
  authContractVersion: '1',
  formatVersion: 1,
  payload: { version: 1, ciphertext: 'synthetic-sealed-material' },
});
const initial = () => ({
  rootId,
  expectedRevision: 0,
  mutationId: 'create',
  fingerprint: 'create-hash',
  graph: graph(1),
  result: { created: 'account' },
  credentials: [
    {
      accountId: 'account',
      expectedRevision: 0,
      expectedIncarnation: 'first-incarnation',
      record: credential(),
    },
  ],
});

it('reads the canonical stored graph offline without starting a Host or creating a missing database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inference-readonly-'));
  const database = { dialect: 'sqlite', filename: join(directory, 'state.sqlite') };
  const missing = { ...database, filename: join(directory, 'missing.sqlite') };
  const db = createDatabaseHost(database);
  const repository = new DatabaseInferenceRepository({ database: db, normalizeGraph });
  try {
    expect(() => readStoredInferenceGraph({ database: missing, rootId })).toThrow('unavailable');
    await expect(stat(missing.filename)).rejects.toMatchObject({ code: 'ENOENT' });
    await db.start();
    await repository.commit(initial());
    await db.stop();
    const before = await readFile(database.filename);
    expect(readStoredInferenceGraph({ database, rootId })).toEqual(graph(1));
    expect(readStoredInferenceGraph({ database, rootId: '/other-root' })).toBeUndefined();
    expect(await readFile(database.filename)).toEqual(before);
  } finally {
    await db.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it('commits the SQLite graph, receipt and encrypted credentials together, replays by mutation and restores after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inference-repository-'));
  const config = { dialect: 'sqlite', filename: join(directory, 'state.sqlite') };
  let db = createDatabaseHost(config);
  let repo = new DatabaseInferenceRepository({ database: db, normalizeGraph });
  try {
    await db.start();
    expect(await repo.readGraph({ rootId })).toBeUndefined();
    expect(await repo.commit(initial())).toMatchObject({
      status: 'committed',
      replayed: false,
      receipt: { graphRevision: 1 },
    });
    expect(await repo.readCredential({ rootId, accountId: 'account' })).toEqual(credential());
    expect(await repo.commit(initial())).toMatchObject({ status: 'committed', replayed: true });
    expect(await repo.commit({ ...initial(), fingerprint: 'another-body' })).toEqual({
      status: 'conflict',
      reason: 'mutation-content',
    });
    expect(await repo.readGraph({ rootId: '/other-host' })).toBeUndefined();
    expect(
      await repo.readCredential({ rootId: '/other-host', accountId: 'account' })
    ).toBeUndefined();
    await db.stop();
    db = createDatabaseHost(config);
    repo = new DatabaseInferenceRepository({ database: db, normalizeGraph });
    await db.start();
    expect(await repo.readGraph({ rootId })).toEqual(graph(1));
    expect(await repo.commit(initial())).toMatchObject({ status: 'committed', replayed: true });
    expect(await repo.readMutation({ rootId, mutationId: 'create' })).toMatchObject({
      result: { created: 'account' },
    });
  } finally {
    await db.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it('rolls back graph and receipt when the credential CAS conflicts, without changing a public revision on refresh', async () => {
  const db = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' });
  const repo = new DatabaseInferenceRepository({ database: db, normalizeGraph });
  try {
    await db.start();
    await repo.commit(initial());
    expect(
      await repo.commit({
        ...initial(),
        expectedRevision: 1,
        graph: graph(2),
        mutationId: 'bad-key',
        fingerprint: 'bad-key',
        credentials: [
          {
            accountId: 'account',
            expectedRevision: 0,
            expectedIncarnation: 'first-incarnation',
            record: credential(),
          },
        ],
      })
    ).toEqual({ status: 'conflict', reason: 'credential' });
    expect(await repo.readGraph({ rootId })).toEqual(graph(1));
    expect(await repo.readMutation({ rootId, mutationId: 'bad-key' })).toBeUndefined();
    expect(
      await repo.commitCredential({
        rootId,
        write: {
          accountId: 'account',
          expectedRevision: 1,
          expectedIncarnation: 'first-incarnation',
          expectedAuthContractVersion: '1',
          record: credential(2),
        },
      })
    ).toEqual({ status: 'committed' });
    expect((await repo.readGraph({ rootId }))?.revision).toBe(1);
    expect((await repo.readCredential({ rootId, accountId: 'account' }))?.revision).toBe(2);
  } finally {
    await db.stop();
  }
});

it('keeps commit-unknown when the commit and receipt lookup are unavailable, and recovers a lost commit acknowledgement by receipt', async () => {
  const db = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' });
  const base = new DatabaseInferenceRepository({ database: db, normalizeGraph });
  try {
    await db.start();
    const lost: DatabaseHost = {
      ...db,
      transaction: async <T>(work: (tx: DatabaseHostTransaction) => Promise<T>) => {
        await db.transaction!(work);
        throw new Error('synthetic acknowledgement lost');
      },
    };
    const repo = new DatabaseInferenceRepository({ database: lost, normalizeGraph });
    expect(await repo.commit(initial())).toMatchObject({ status: 'committed', replayed: true });
    const failed: DatabaseHost = {
      ...db,
      transaction: async () => {
        throw new Error('synthetic unavailable');
      },
      models: {
        get() {
          throw new Error('synthetic private credential-bearing cause');
        },
      },
    };
    const failedRepo = new DatabaseInferenceRepository({ database: failed, normalizeGraph });
    // A failed preflight is provably not submitted, as opposed to an exception after transaction entry.
    expect(
      await failedRepo.commit({
        ...initial(),
        expectedRevision: 1,
        graph: graph(2),
        mutationId: 'preflight',
      })
    ).toEqual({ status: 'not-committed' });
    const unknown = new DatabaseInferenceRepository({
      database: {
        ...db,
        transaction: async () => {
          throw new Error('unsettled commit');
        },
      },
      normalizeGraph,
    });
    const lookup = vi
      .spyOn(unknown, 'readMutation')
      .mockRejectedValue(new Error('lookup unavailable'));
    expect(
      await unknown.commit({
        ...initial(),
        expectedRevision: 1,
        graph: graph(2),
        mutationId: 'unknown',
      })
    ).toEqual({ status: 'commit-unknown' });
    expect(lookup).toHaveBeenCalledOnce();
    expect(await base.readGraph({ rootId })).toEqual(graph(1));
  } finally {
    await db.stop();
  }
});

it('does not let a stale credential handle recreate or erase credentials after account removal/replacement', async () => {
  const db = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' });
  const repo = new DatabaseInferenceRepository({ database: db, normalizeGraph });
  try {
    await db.start();
    await repo.commit(initial());
    const removed = { ...graph(2), accounts: {} };
    expect(
      await repo.commit({
        ...initial(),
        expectedRevision: 1,
        mutationId: 'remove',
        fingerprint: 'remove',
        graph: removed,
        credentials: [
          {
            accountId: 'account',
            expectedRevision: 1,
            expectedIncarnation: 'first-incarnation',
            record: null,
          },
        ],
      })
    ).toMatchObject({ status: 'committed' });
    expect(
      await repo.commitCredential({
        rootId,
        write: {
          accountId: 'account',
          expectedRevision: 0,
          expectedIncarnation: 'first-incarnation',
          record: credential(),
        },
      })
    ).toEqual({ status: 'conflict' });
    const recreated = graph(3);
    const account = { ...recreated.accounts.account!, incarnation: 'new-incarnation' };
    expect(
      await repo.commit({
        rootId,
        expectedRevision: 2,
        mutationId: 'new',
        fingerprint: 'new',
        graph: { ...recreated, accounts: { account } },
        result: null,
      })
    ).toMatchObject({ status: 'committed' });
    expect(
      await repo.commitCredential({
        rootId,
        write: {
          accountId: 'account',
          expectedRevision: 0,
          expectedIncarnation: 'first-incarnation',
          record: null,
        },
      })
    ).toEqual({ status: 'conflict' });
  } finally {
    await db.stop();
  }
});
