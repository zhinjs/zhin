import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definePlugin, rootPluginId } from '@zhin.js/plugin-runtime';
import { aiProviderDefinitionsToken, type ProviderGraph } from '@zhin.js/ai/provider';
import { AIService } from '@zhin.js/agent';
import { createConfigDocument, RootRuntime } from '@zhin.js/runtime';
import { openAiProvider } from '../../../../../packages/im/ai/src/providers/api-key.js';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { HostInference } from '../../../src/plugin-runtime/inference/host.js';
import { ConsoleConfigurationStore } from '../../../src/plugin-runtime/console/configuration.js';

/** Local composition of the real file authority and the independent inference repository. */
export async function configurationFixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'inference-configuration-')));
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'configuration-fixture', type: 'module',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', features: [] } }));
  await writeFile(join(directory, 'plugin.js'), 'export default {};');
  const file = join(directory, 'zhin.config.json');
  await writeFile(file, JSON.stringify({ configVersion: 2, http: { port: 8086 }, menuKeyword: 'old' }));
  const document = createConfigDocument(file), root = rootPluginId();
  const runtime = new RootRuntime({ projectRoot: directory, config: document, environment: { name: 'test', mode: 'test', platform: 'node' },
    modules: { load: async <T>() => ({ default: definePlugin({ name: 'configuration-fixture' }) }) as T,
      invalidate: () => {}, close: async () => {} },
    installResources: ({ resources }) => {
      resources.provide(aiProviderDefinitionsToken, [{ owner: root, definition: openAiProvider }]);
    },
  });
  const db = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' });
  const resolveSource = vi.fn(async (source: string): Promise<string> => source === 'env://OLD_KEY' ? 'synthetic-old-key' : 'synthetic-next-key');
  const host = new HostInference({ projectRoot: directory, database: db, snapshots: () => runtime.snapshots,
    resolveSource, personalOwners: [] });
  const requests: Request[] = [];
  let transport: ((request: Request) => Promise<Response>) | undefined;
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init); requests.push(request);
    if (transport) return transport(request);
    const body = await request.clone().json();
    if (request.url.includes('/images/')) return Response.json({ created: 1, data: [{ b64_json: 'aW1hZ2U=' }] });
    return Response.json({ id: 'synthetic', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: body.model }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  const graph: ProviderGraph = { rootId: host.rootId, revision: 1, services: Object.fromEntries(['old', 'next'].map(name => [name, {
    id: name, rootId: host.rootId, ownerId: host.hostOwnerId, revision: 1,
    driver: { id: 'openai', owner: root, contractVersion: '1' }, options: { baseUrl: `https://${name}.example/v1` },
    models: { [name]: { id: name, kinds: ['language'], protocol: 'openai-chat', input: ['text'], toolCalling: true },
      image: { id: 'image', kinds: ['image'], protocol: 'openai-images' } },
  }])), accounts: Object.fromEntries(['old', 'next'].map(name => [name, {
    id: name, rootId: host.rootId, ownerId: host.hostOwnerId, revision: 1, serviceId: name, incarnation: name,
    authentication: { method: 'api-key', source: `env://${name.toUpperCase()}_KEY` },
  }])), profiles: Object.fromEntries(['old', 'next'].flatMap(name => [
    [name, { id: name, rootId: host.rootId, ownerId: host.hostOwnerId, revision: 1, accountId: name, model: name, parameters: { maxRetries: 0 } }],
    [`${name}-image`, { id: `${name}-image`, rootId: host.rootId, ownerId: host.hostOwnerId, revision: 1, accountId: name, model: 'image', parameters: { maxRetries: 0 } }],
  ])), purposes: { defaults: { chat: 'old', image: 'old-image' } } };
  await db.start();
  await host.repository.commit({ rootId: host.rootId, expectedRevision: 0, mutationId: 'initial', fingerprint: 'initial', graph, result: null });
  await runtime.start();
  const service = new AIService({ agents: { zhin: {} } });
  await service.prepareModelRuntime(host.modelRuntimeOptions());
  const store = new ConsoleConfigurationStore({ projectRoot: directory, document,
    validateConfiguration: value => runtime.validateConfiguration(value),
    applyConfiguration: revision => runtime.applyConfiguration(revision), readApplication: () => runtime.configurationApplication });
  return { directory, file, document, runtime, host, db, graph, service, store, requests, network, resolveSource,
    setTransport(value: typeof transport) { transport = value; },
    async publish(options: Readonly<{ purposes?: ProviderGraph['purposes'] }> = {}) { await host.repository.commit({ rootId: host.rootId, expectedRevision: 1, mutationId: 'next', fingerprint: 'next',
      graph: { ...graph, revision: 2, purposes: options.purposes ?? { defaults: { chat: 'next', image: 'next-image' } } }, result: null }); },
    async close() { network.mockRestore(); await service.dispose(); await host.close(); await runtime.stop(); await db.stop();
      await rm(directory, { recursive: true, force: true }); },
  };
}

export const configurationPrompt = { systemPrompt: '', messages: [{ role: 'user' as const, timestamp: 1,
  content: [{ type: 'text' as const, text: 'synthetic prompt' }] }] };
