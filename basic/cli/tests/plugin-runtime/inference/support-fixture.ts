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
import { personalSessionOwnerId } from '@zhin.js/agent/personal-session';
import type { ProviderDefinition, ProviderGraph } from '@zhin.js/ai/provider';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { HostInference } from '../../../src/plugin-runtime/inference/host.js';

/** The real management producer with synthetic declarations; no SDK or credential is needed. */
export async function supportFixture(
  options: Readonly<{ support?: unknown }> = {}
) {
  const directory = await mkdtemp(join(tmpdir(), 'inference-support-'));
  const root = rootPluginId(),
    other = childPluginId(root, 'community');
  const database = createDatabaseHost({
    dialect: 'sqlite',
    filename: ':memory:',
  });
  const personal = {
    rootId: directory,
    platform: 'synthetic',
    endpoint: 'account',
    adapterId: 'adapter',
    subjectId: 'member',
  };
  const unavailable = () => {
    throw new Error('A metadata view must not execute a Driver');
  };
  function definition(support: unknown): ProviderDefinition<unknown, unknown> {
    const value: ProviderDefinition<unknown, unknown> = {
      id: 'same',
      contractVersion: '1',
      label: 'Same name',
      serviceSchema: { parse: unavailable },
      models: unavailable,
      targets: unavailable,
      discover: unavailable,
      identity: unavailable,
      authentication: { methods: ['none'] },
      createExecution: unavailable,
    };
    // Models a JavaScript plugin as well: unknown/extra fields cannot cross the public projection.
    if (support !== undefined)
      Object.defineProperty(value, 'support', { value: support });
    return value;
  }
  function state(support: unknown): SnapshotState {
    return {
      root,
      tree: new Map(
        [root, other].map((owner) => [
          owner,
          {
            id: owner,
            instanceKey: String(owner),
            packageName: '@test/synthetic',
            packageRoot: directory,
            children: [],
          },
        ])
      ),
      config: new Map(),
      capabilities: new Map(),
      projections: new Map(),
      resources: new Map([
        [
          root,
          new Map([
            [
              aiProviderDefinitionsToken.id,
              [{ owner: root, definition: definition(support) }],
            ],
          ]),
        ],
        [
          other,
          new Map([
            [
              aiProviderDefinitionsToken.id,
              [
                {
                  owner: other,
                  definition: definition({
                    status: 'standard',
                    notice: 'Other owner',
                  }),
                },
              ],
            ],
          ]),
        ],
      ]),
    };
  }
  const support =
    'support' in options
      ? options.support
      : {
          status: 'experimental',
          notice: 'Experimental fixture',
          privateMarker: 'not-public-support',
        };
  const snapshots = new SnapshotStore(state(support));
  const host = new HostInference({
    projectRoot: directory,
    database,
    snapshots: () => snapshots,
    resolveSource: unavailable,
    personalOwners: [personal],
  });
  const references = {
    chosen: { id: 'same', owner: root, contractVersion: '1' },
    other: { id: 'same', owner: other, contractVersion: '1' },
    stale: { id: 'same', owner: root, contractVersion: 'not-installed' },
    missing: { id: 'not-installed', owner: root, contractVersion: '1' },
  };
  const graph: ProviderGraph = {
    rootId: host.rootId,
    revision: 1,
    services: Object.fromEntries(
      Object.entries(references).map(([id, driver]) => [
        id,
        {
          id,
          rootId: host.rootId,
          ownerId: host.hostOwnerId,
          revision: 1,
          driver,
          options: { privateMarker: 'not-a-member-service' },
          models: {
            native: { id: 'native', protocol: 'fixture', kinds: ['language'] },
          },
        },
      ])
    ),
    accounts: Object.fromEntries(
      Object.keys(references).map((id) => [
        id,
        {
          id,
          rootId: host.rootId,
          ownerId: host.hostOwnerId,
          revision: 1,
          serviceId: id,
          incarnation: id,
          authentication: { method: 'none' },
        },
      ])
    ),
    profiles: Object.fromEntries(
      Object.keys(references).map((id) => [
        id,
        {
          id,
          rootId: host.rootId,
          ownerId: host.hostOwnerId,
          revision: 1,
          accountId: id,
          model: 'native',
          parameters: {},
        },
      ])
    ),
    purposes: { defaults: { chat: 'chosen' } },
  };
  await database.start();
  await host.repository.commit({
    rootId: host.rootId,
    expectedRevision: 0,
    mutationId: 'initial',
    fingerprint: 'initial',
    graph,
    result: null,
  });
  return {
    host,
    database,
    snapshots,
    directory,
    root,
    other,
    graph,
    operator: { ownerId: host.hostOwnerId, hostAdministrator: true },
    member: {
      ownerId: personalSessionOwnerId(personal),
      hostAdministrator: false,
    },
    next(support: unknown) {
      snapshots.commit(snapshots.current.generation, {
        snapshot: state(support),
        dispose: async () => {},
      });
    },
    async close() {
      await host.close();
      await snapshots.close();
      await database.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
