import type { EnvironmentExpressionSource } from './credentials.js';
import { aiProviderDefinitionsToken } from '@zhin.js/ai/provider';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import type { PersonalSessionOwner } from '@zhin.js/agent/personal-session';
import { createDatabaseHost, type DatabaseHostConfig } from '../database-host-installer.js';
import { HostInference } from './host.js';

export interface HeadlessInferenceHostOptions {
  readonly projectRoot: string;
  readonly database: DatabaseHostConfig;
  /** Explicit process port. This helper never loads dotenv or another CLI's authorization cache. */
  readonly resolveSource: (reference: string | EnvironmentExpressionSource) => string | undefined | Promise<string | undefined>;
  readonly personalOwners?: readonly PersonalSessionOwner[];
  /** Metadata-only migration reads do not import any product Driver declarations. */
  readonly officialDrivers?: boolean;
}
/** Official pure declarations only. It does not discover project plugins or pretend to run their setup.
 * Custom Driver references remain unavailable here; use an already captured normal Host operation. */
export async function openHeadlessInferenceHost(options: HeadlessInferenceHostOptions) {
  const root = rootPluginId();
  const definitions =
    options.officialDrivers === false
      ? []
      : (await import('@zhin.js/ai/providers')).builtinAiProviders;
  const snapshot: SnapshotState = {
    root,
    tree: new Map([
      [
        root,
        {
          id: root,
          instanceKey: 'root',
          packageName: 'zhin-headless-inference',
          packageRoot: options.projectRoot,
          children: [],
        },
      ],
    ]),
    config: new Map(),
    capabilities: new Map(),
    projections: new Map(),
    resources: new Map([
      [
        root,
        new Map([
          [
            aiProviderDefinitionsToken.id,
            definitions.map((definition) => ({ owner: root, definition })),
          ],
        ]),
      ],
    ]),
  };
  const snapshots = new SnapshotStore(snapshot),
    database = createDatabaseHost(options.database);
  const host = new HostInference({
    ...options,
    database,
    snapshots: () => snapshots,
    personalOwners: options.personalOwners ?? [],
  });
  let closed: Promise<void> | undefined;
  const close = () =>
    (closed ??= (async () => {
      try {
        await host.close();
      } finally {
        try {
          await snapshots.close();
        } finally {
          await database.stop();
        }
      }
    })());
  try {
    await database.start();
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
  return Object.freeze({ host, database, snapshots, close });
}
