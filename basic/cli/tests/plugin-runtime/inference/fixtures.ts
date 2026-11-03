import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeProviderGraph, type ProviderDefinition, type ProviderGraph } from '@zhin.js/ai/provider';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { DatabaseInferenceRepository } from '../../../src/plugin-runtime/inference/repository.js';
import { InferenceCredentialStore } from '../../../src/plugin-runtime/inference/credentials.js';
import { HostAccountRuntime } from '../../../src/plugin-runtime/inference/account-runtime.js';
import { InferenceManagementService } from '../../../src/plugin-runtime/inference/management.js';

export async function setupInferenceManagement(options: Readonly<{ method?: 'api-key' | 'oauth' }> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'inference-management-'));
  const db = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'state.sqlite') });
  const repository = new DatabaseInferenceRepository({ database: db, normalizeGraph: normalizeProviderGraph });
  const model = { id: 'example', kinds: ['language'] as const, protocol: 'fixture' };
  const graph: ProviderGraph = { rootId: '/root', revision: 1, services: {
    service: { id: 'service', rootId: '/root', ownerId: 'host', revision: 1, driver: { id: 'fixture', owner: 'root/driver', contractVersion: '1' }, options: {}, models: { example: model } },
  }, accounts: { account: { id: 'account', rootId: '/root', ownerId: 'host', revision: 1, serviceId: 'service', incarnation: 'first', authentication: { method: options.method ?? 'api-key' } } },
  profiles: { profile: { id: 'profile', rootId: '/root', ownerId: 'host', revision: 1, accountId: 'account', model: 'example', parameters: {} } },
  purposes: { defaults: { chat: 'profile' } } };
  const exchange = vi.fn(async () => ({ accessToken: 'private-synthetic-token', refreshToken: 'private-synthetic-refresh' }));
  const definition: ProviderDefinition<unknown, unknown> = { id: 'fixture', contractVersion: '1', serviceSchema: { parse: value => value },
    authentication: { methods: ['api-key', 'oauth'], oauth: { contractVersion: '1', redirectUri: 'http://localhost:1455/auth/callback',
      begin: async () => ({ authorizationUrl: 'https://provider.test/authorize', state: 'fixture-state', privateState: { verifier: 'private-verifier' } }),
      complete: exchange, refresh: vi.fn(),
    } }, models: () => ({ example: model }), targets: () => ({ authentication: [], inference: ['https://example.test/v1'] }), createExecution: () => ({}) };
  const store = new InferenceCredentialStore({ directory: join(directory, 'private'), repository });
  const accounts = new HostAccountRuntime({ hostOwnerId: 'host', repository, credentials: store,
    drivers: { acquire: async () => ({ definition, reference: graph.services.service!.driver, release() {} }) },
    fetch: () => vi.fn(), allowTarget: () => true, resolveSource: vi.fn() });
  const management = new InferenceManagementService({ rootId: '/root', hostOwnerId: 'host', directory: join(directory, 'private'), repository, accounts,
    authenticationContract: () => '1',
    profileSchema: input => definition.profileSchema?.(input),
    discover: async () => [],
    drivers: () => [],
    resolveService: input => ({ driver: graph.services.service!.driver, options: input.options, models: Object.keys(input.models).length ? input.models : { example: model } }) });
  await db.start();
  await repository.commit({ rootId: '/root', expectedRevision: 0, mutationId: 'initial', fingerprint: 'initial', graph, result: null });
  const principal = { ownerId: 'host', hostAdministrator: true };
  return { graph, definition, accounts, repository, management, principal, exchange, db, directory,
    async close() { await accounts.close(); await db.stop(); await rm(directory, { recursive: true, force: true }); } };
}
