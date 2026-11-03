import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SnapshotStore,
  rootPluginId,
  childPluginId,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { aiProviderDefinitionsToken } from '@zhin.js/ai-provider';
import {
  createProviderResourceKey,
  type ProviderDefinition,
  type ProviderGraph,
} from '@zhin.js/ai/provider';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { HostInference } from '../../../src/plugin-runtime/inference/host.js';
import { openHeadlessInferenceHost } from '../../../src/plugin-runtime/inference/headless-host.js';

it.each(['none', 'api-key'])(
  'rejects unsupported %s authentication for a real subscription Driver before reading credentials',
  async (method) => {
    const directory = await mkdtemp(join(tmpdir(), 'inference-subscription-auth-'));
    const resolveSource = vi.fn(),
      fetch = vi.spyOn(globalThis, 'fetch');
    const opened = await openHeadlessInferenceHost({
      projectRoot: directory,
      database: { dialect: 'sqlite', filename: join(directory, 'state.sqlite') },
      resolveSource,
    });
    const held = opened.host.acquireManagement(),
      readCredential = vi.spyOn(opened.host.repository, 'readCredential');
    try {
      await expect(
        held.management.review(
          { ownerId: opened.host.hostOwnerId, hostAdministrator: true },
          {
            plan: {
              version: 1,
              services: { subscription: { driver: 'codex-subscription' } },
              accounts: { noProfile: { service: 'subscription', auth: { method } } },
            },
          }
        )
      ).rejects.toMatchObject({ code: 'invalid-input' });
      expect(
        await opened.host.repository.readGraph({ rootId: opened.host.rootId })
      ).toBeUndefined();
      expect(readCredential).not.toHaveBeenCalled();
      expect(resolveSource).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
      await held.release();
      await opened.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
it('uses real operation leases while retaining only non-secret binding state across turns and isolating account replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inference-host-'));
  const db = createDatabaseHost({
    dialect: 'sqlite',
    filename: join(directory, 'state.sqlite'),
  });
  const root = rootPluginId(),
    stateKey = createProviderResourceKey<{ uses: number }>('fixture cache');
  const disposed = vi.fn();
  const definition: ProviderDefinition<unknown, unknown> = {
    id: 'fixture',
    contractVersion: '1',
    serviceSchema: { parse: (value) => value },
    models: (service) => service.models,
    authentication: { methods: ['none'] },
    targets: () => ({ authentication: [], inference: [] }),
    createExecution({ resources }) {
      const state = resources.getOrCreate({
        key: stateKey,
        create: () => ({ value: { uses: 0 }, dispose: disposed }),
      });
      return {
        image: {
          generate: async () => ({
            model: 'image',
            mimeType: 'image/png',
            base64: String(++state.uses),
          }),
        },
      };
    },
  };
  const snapshot: SnapshotState = {
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
      [root, new Map([[aiProviderDefinitionsToken.id, [{ owner: root, definition }]]])],
    ]),
    capabilities: new Map(),
    projections: new Map(),
  };
  const snapshots = new SnapshotStore(snapshot);
  const host = new HostInference({
    projectRoot: directory,
    database: db,
    snapshots: () => snapshots,
    resolveSource: vi.fn(),
    personalOwners: [],
  });
  const graph: ProviderGraph = {
    rootId: host.rootId,
    revision: 1,
    services: {
      service: {
        id: 'service',
        rootId: host.rootId,
        ownerId: host.hostOwnerId,
        revision: 1,
        driver: { id: 'fixture', owner: root, contractVersion: '1' },
        options: {},
        models: {
          image: { id: 'image', kinds: ['image'], protocol: 'fixture' },
        },
      },
    },
    accounts: {
      account: {
        id: 'account',
        rootId: host.rootId,
        ownerId: host.hostOwnerId,
        revision: 1,
        serviceId: 'service',
        incarnation: 'first',
        authentication: { method: 'none' },
      },
    },
    profiles: {
      profile: {
        id: 'profile',
        rootId: host.rootId,
        ownerId: host.hostOwnerId,
        revision: 1,
        accountId: 'account',
        model: 'image',
        parameters: {},
      },
    },
    purposes: { defaults: { image: 'profile' } },
  };
  async function generate(operationId: string) {
    const lease = snapshots.acquire(),
      runtime = host.createInference(lease);
    const client = await runtime.openOperation({
      context: {
        rootId: host.rootId,
        ownerId: host.hostOwnerId,
        hostOwnerId: host.hostOwnerId,
        operationId,
        sessionKey: 'session',
      },
    });
    try {
      return await client.generateImage({ request: { prompt: 'synthetic' } });
    } finally {
      await client.close();
      runtime.retire();
      lease.release();
    }
  }
  try {
    await db.start();
    await host.repository.commit({
      rootId: host.rootId,
      expectedRevision: 0,
      mutationId: 'initial',
      fingerprint: 'initial',
      graph,
      result: null,
    });
    expect((await generate('one')).base64).toBe('1');
    expect((await generate('two')).base64).toBe('2');
    expect(disposed).not.toHaveBeenCalled();
    await host.repository.commit({
      rootId: host.rootId,
      expectedRevision: 1,
      mutationId: 'replace',
      fingerprint: 'replace',
      graph: {
        ...graph,
        revision: 2,
        accounts: {
          account: { ...graph.accounts.account!, incarnation: 'replacement' },
        },
      },
      result: null,
    });
    expect((await generate('three')).base64).toBe('1');
    expect(disposed).toHaveBeenCalledOnce();
  } finally {
    await host.close();
    await snapshots.close();
    await db.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it('requires exact owner selection when two real held Driver declarations share a name and rejects a stale contract without networking', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inference-drivers-'));
  const db = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' });
  const root = rootPluginId(),
    child = childPluginId(root, 'other');
  const parse = vi.fn((value: unknown) => value),
    create = vi.fn();
  const definition = (label: string): ProviderDefinition<unknown, unknown> => ({
    id: 'same',
    contractVersion: '1',
    label,
    serviceSchema: { parse },
    authentication: { methods: ['none'] },
    models: (service) => service.models,
    targets: () => ({ authentication: [], inference: [] }),
    createExecution: create,
  });
  const state: SnapshotState = {
    root,
    tree: new Map(
      [root, child].map((id) => [
        id,
        {
          id,
          instanceKey: String(id),
          packageName: 'fixture',
          packageRoot: directory,
          children: [],
        },
      ])
    ),
    config: new Map(),
    resources: new Map(
      [root, child].map((owner) => [
        owner,
        new Map([
          [aiProviderDefinitionsToken.id, [{ owner, definition: definition(String(owner)) }]],
        ]),
      ])
    ),
    capabilities: new Map(),
    projections: new Map(),
  };
  const snapshots = new SnapshotStore(state),
    resolveSource = vi.fn();
  const host = new HostInference({
    projectRoot: directory,
    database: db,
    snapshots: () => snapshots,
    resolveSource,
    personalOwners: [],
  });
  const held = host.acquireManagement();
  try {
    await db.start();
    const plan = (driver: unknown) => ({
      plan: { version: 1, services: { chosen: { driver, options: {} } } },
    });
    const principal = { ownerId: host.hostOwnerId, hostAdministrator: true };
    await expect(held.management.review(principal, plan('same'))).rejects.toThrow('ambiguous');
    const prepared = await held.management.review(
      principal,
      plan({ id: 'same', owner: child, contractVersion: '1' })
    );
    expect(
      await held.management.apply(principal, {
        prepared: prepared.prepared,
        mutationId: 'exact-owner',
      })
    ).toMatchObject({ status: 'committed' });
    expect(
      Object.values((await host.repository.readGraph({ rootId: host.rootId }))!.services)[0].driver
        .owner
    ).toBe(child);
    await expect(
      held.management.review(principal, plan({ id: 'same', owner: root, contractVersion: 'stale' }))
    ).rejects.toMatchObject({ code: 'driver-contract-mismatch' });
    expect(create).not.toHaveBeenCalled();
    expect(resolveSource).not.toHaveBeenCalled();
  } finally {
    await held.release();
    await host.close();
    await snapshots.close();
    await db.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
