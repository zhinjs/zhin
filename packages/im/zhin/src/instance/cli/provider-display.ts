/**
 * Provider display lookups for `zhin usage report` (#1250): traces record `services:<id>` or
 * `accounts:<id>` depending on the call path; the graph in the project database maps both to
 * the service people configured. Read-only; any failure means "no names", never an error.
 */
import { resolve } from 'node:path';
import { createCliProjectDatabaseHost } from './project-database.js';
import { createProviderDisplayIndex, type ProviderDisplayIndex } from '../inference/provider-display.js';

export async function loadProviderDisplay(root: string): Promise<ProviderDisplayIndex | undefined> {
  let agent: typeof import('@zhin.js/agent/runtime');
  let provider: typeof import('@zhin.js/ai/provider');
  try {
    [agent, provider] = await Promise.all([import('@zhin.js/agent/runtime'), import('@zhin.js/ai/provider')]);
  } catch {
    return undefined; // IM-only install: no inference graph.
  }
  let stop: (() => Promise<void>) | undefined;
  try {
    const database = await createCliProjectDatabaseHost(root);
    if (!['sqlite', 'mysql', 'pg'].includes(database.dialect)) return undefined;
    const repository = new agent.DatabaseInferenceRepository({ database, normalizeGraph: provider.normalizeProviderGraph });
    await database.start();
    stop = () => database.stop();
    const graph = await repository.readGraph({ rootId: resolve(root) });
    return graph ? createProviderDisplayIndex(graph) : undefined;
  } catch {
    return undefined;
  } finally {
    await stop?.().catch(() => undefined);
  }
}
