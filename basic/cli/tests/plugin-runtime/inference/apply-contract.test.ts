import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { aiProviderDefinitionsToken } from '@zhin.js/ai-provider';
import type { AuthenticationMethod, ProviderDefinition } from '@zhin.js/ai/provider';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { HostInference } from '../../../src/plugin-runtime/inference/host.js';

interface DriverSnapshotOptions {
  readonly contractVersion?: string;
  readonly authContract?: string;
  readonly present?: boolean;
  readonly methods?: readonly AuthenticationMethod[];
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'inference-apply-contract-')),
    root = rootPluginId();
  const db = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' }),
    exchange = vi.fn();
  function state({
    contractVersion = '1',
    authContract = '1',
    present = true,
    methods = ['api-key', 'oauth'],
  }: DriverSnapshotOptions = {}): SnapshotState {
    const definition: ProviderDefinition<unknown, unknown> = {
      id: 'fixture',
      contractVersion,
      serviceSchema: { parse: (value) => value },
      models: (service) => service.models,
      authentication: {
        methods,
        oauth: {
          contractVersion: authContract,
          redirectUri: 'http://localhost:1455/auth/callback',
          begin: exchange,
          complete: exchange,
          refresh: exchange,
        },
      },
      targets: () => ({ authentication: [], inference: [] }),
      createExecution: vi.fn(),
    };
    return {
      root,
      tree: new Map([
        [
          root,
          {
            id: root,
            instanceKey: 'root',
            packageName: 'fixture',
            packageRoot: directory,
            children: [],
          },
        ],
      ]),
      config: new Map(),
      resources: new Map([
        [
          root,
          new Map([[aiProviderDefinitionsToken.id, present ? [{ owner: root, definition }] : []]]),
        ],
      ]),
      capabilities: new Map(),
      projections: new Map(),
    };
  }
  const snapshots = new SnapshotStore(state()),
    host = new HostInference({
      projectRoot: directory,
      database: db,
      snapshots: () => snapshots,
      resolveSource: vi.fn(),
      personalOwners: [],
    });
  await db.start();
  const principal = { ownerId: host.hostOwnerId, hostAdministrator: true };
  const initial = host.acquireManagement();
  const change = await initial.management.review(principal, {
    plan: {
      version: 1,
      services: {
        s: {
          driver: 'fixture',
          options: {},
          models: {
            one: { id: 'one', protocol: 'fixture', kinds: ['language'] },
            two: { id: 'two', protocol: 'fixture', kinds: ['language'] },
          },
        },
      },
      accounts: {
        key: { service: 's', auth: { method: 'api-key' } },
        oauth: { service: 's', auth: { method: 'oauth' } },
      },
      profiles: { one: { account: 'key', model: 'one' }, two: { account: 'key', model: 'two' } },
      purposes: { chat: { profile: 'one' } },
    },
  });
  await initial.management.apply(principal, { prepared: change.prepared, mutationId: 'initial' });
  await initial.release();
  return {
    host,
    snapshots,
    principal,
    exchange,
    bindings: change.bindings!,
    publish(contract = '1', auth = '1', present = true) {
      snapshots.commit(snapshots.current.generation, {
        snapshot: state({ contractVersion: contract, authContract: auth, present }),
        dispose() {},
      });
    },
    publishMethods(methods: readonly AuthenticationMethod[]) {
      snapshots.commit(snapshots.current.generation, {
        snapshot: state({ methods }),
        dispose() {},
      });
    },
    async close() {
      await host.close();
      await snapshots.close();
      await db.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

it('rejects a prepared model mutation and a newly selected existing Profile after the current held Driver contract changes', async () => {
  const f = await setup(),
    before = f.host.acquireManagement();
  const model = await before.management.review(f.principal, {
    plan: {
      version: 1,
      profiles: { one: { account: 'key', model: 'one', parameters: { temperature: 0.5 } } },
    },
    bindings: f.bindings,
  });
  const purpose = await before.management.review(f.principal, {
    plan: { version: 1, purposes: { chat: { profile: 'two' } } },
    bindings: f.bindings,
  });
  await before.release();
  f.publish('2');
  const current = f.host.acquireManagement();
  try {
    for (const [id, change] of [
      ['model', model],
      ['purpose', purpose],
    ] as const) {
      await expect(
        current.management.apply(f.principal, { prepared: change.prepared, mutationId: id })
      ).rejects.toMatchObject({ code: 'driver-contract-mismatch' });
      expect(
        await f.host.repository.readMutation({ rootId: f.host.rootId, mutationId: id })
      ).toBeUndefined();
    }
    expect((await f.host.repository.readGraph({ rootId: f.host.rootId }))!.revision).toBe(1);
    expect(f.exchange).not.toHaveBeenCalled();
  } finally {
    await current.release();
    await f.close();
  }
});

it('rechecks authentication on an affected Account without a Profile, while preserving proved receipt recovery', async () => {
  const f = await setup(),
    before = f.host.acquireManagement();
  const plan = (alias: string) => ({
    plan: { version: 1, accounts: { [alias]: { service: 's', auth: { method: 'api-key' } } } },
    bindings: f.bindings,
  });
  const saved = await before.management.review(f.principal, plan('saved'));
  expect(
    await before.management.apply(f.principal, {
      prepared: saved.prepared,
      mutationId: 'saved-account',
    })
  ).toMatchObject({ status: 'committed' });
  const pending = await before.management.review(f.principal, plan('pending'));
  await before.release();
  f.publishMethods(['oauth']);
  const current = f.host.acquireManagement(),
    credentialReads = vi.spyOn(f.host.repository, 'readCredential');
  try {
    await expect(
      current.management.apply(f.principal, {
        prepared: pending.prepared,
        mutationId: 'unsupported-method',
      })
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(
      await f.host.repository.readMutation({
        rootId: f.host.rootId,
        mutationId: 'unsupported-method',
      })
    ).toBeUndefined();
    expect((await f.host.repository.readGraph({ rootId: f.host.rootId }))?.revision).toBe(2);
    expect(credentialReads).not.toHaveBeenCalled();
    expect(f.exchange).not.toHaveBeenCalled();
    expect(
      await current.management.apply(f.principal, {
        prepared: saved.prepared,
        mutationId: 'saved-account',
      })
    ).toMatchObject({ status: 'committed', replayed: true });
  } finally {
    await current.release();
    await f.close();
  }
});

it('rechecks the OAuth credential contract before saving private client metadata and recovers proved receipts without a Driver', async () => {
  const f = await setup(),
    before = f.host.acquireManagement();
  const oauthId = f.bindings.accounts.oauth;
  const client = await before.management.prepareClient(f.principal, {
    accountId: oauthId,
    clientSecret: 'synthetic-client-secret',
    expectedRevision: 0,
  });
  const key = await before.management.prepareKey(f.principal, {
    accountId: f.bindings.accounts.key,
    key: 'synthetic-key',
    expectedRevision: 0,
  });
  expect(
    await before.management.apply(f.principal, { prepared: key.prepared, mutationId: 'proved-key' })
  ).toMatchObject({ status: 'committed' });
  await before.release();
  f.publish('1', '2');
  const current = f.host.acquireManagement();
  try {
    await expect(
      current.management.apply(f.principal, {
        prepared: client.prepared,
        mutationId: 'stale-oauth',
      })
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(
      await f.host.repository.readCredential({ rootId: f.host.rootId, accountId: oauthId })
    ).toBeUndefined();
  } finally {
    await current.release();
  }
  f.publish('2', '2', false);
  const absent = f.host.acquireManagement();
  try {
    expect(
      await absent.management.apply(f.principal, {
        prepared: key.prepared,
        mutationId: 'proved-key',
      })
    ).toMatchObject({ status: 'committed', replayed: true });
    expect(
      await absent.management.apply(f.principal, {
        prepared: client.prepared,
        mutationId: 'proved-key',
      })
    ).toMatchObject({ status: 'conflict', reason: 'mutation-content' });
    expect(f.exchange).not.toHaveBeenCalled();
  } finally {
    await absent.release();
    await f.close();
  }
});
