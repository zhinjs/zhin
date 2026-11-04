import { SnapshotStore, rootPluginId } from '@zhin.js/plugin-runtime';
import { createInferenceRuntime, normalizeProviderGraph } from '@zhin.js/ai/provider';
import { codexProvider } from '@zhin.js/ai/providers';
import { graphFixture, context } from '../../../ai/tests/provider/fixtures.js';
import { sse } from '../../../ai/tests/providers/fixtures.js';
import { ModelRuntimeService } from '../../src/model-runtime/service.js';
import { ZhinAgent } from '../../src/zhin-agent/index.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import { buildAgentPromptCacheStreamOptions } from '../../src/config/zhin-agent-runtime.js';

it('omits framework cache hints when the selected Driver owns routing, preserving explicit cache disable', () => {
  const parts = { modelSdk: 'openai', provider: 'account', modelId: 'selected', label: 'chat', promptCacheRouting: 'driver' as const };
  expect(buildAgentPromptCacheStreamOptions({}, parts, {})).toEqual({ promptCache: true });
  expect(buildAgentPromptCacheStreamOptions({ promptCache: false }, parts, {})).toEqual({ promptCache: false });
});

it('runs the main Agent through Codex without sending generic cache key or retention overrides', async () => {
  const original = graphFixture();
  const graph = normalizeProviderGraph({ ...original,
    services: { service: { ...original.services.service, driver: { id: codexProvider.id, owner: 'root/providers', contractVersion: '1' }, options: {},
      models: { selected: { id: 'selected', kinds: ['language'], protocol: 'codex-responses', input: ['text'], streaming: true } } } },
    accounts: { account: { ...original.accounts.account, authentication: { method: 'oauth' } } },
    profiles: { text: { ...original.profiles.text, model: 'selected' } }, purposes: { defaults: { chat: 'text' } },
  });
  const root = rootPluginId(), snapshots = new SnapshotStore({ root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]), resources: new Map(), config: new Map(), capabilities: new Map(), projections: new Map() });
  const lease = snapshots.acquire(), bodies: Record<string, unknown>[] = [];
  const runtime = new ModelRuntimeService({ rootId: 'root', hostOwnerId: context.hostOwnerId, context: () => context,
    inferenceFactory: () => createInferenceRuntime({ repository: { readGraph: async () => graph },
      drivers: { acquire: async () => ({ reference: graph.services.service.driver, definition: codexProvider, release() {} }) },
      credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ token: 'synthetic-key', revision: '1', headers: {} }) }),
      fetch: () => async (url, init) => { bodies.push(await new Request(url, init).json()); return sse([
        { type: 'response.created', response: { id: 'response-local', created_at: 1, model: 'selected' } },
        { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message-local' } },
        { type: 'response.output_text.delta', item_id: 'message-local', output_index: 0, content_index: 0, delta: 'answer' },
        { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'message-local' } },
        { type: 'response.completed', response: { usage: { input_tokens: 20, output_tokens: 4 } } },
      ]); } }) });
  const models = await runtime.acquireForContext({ lease, snapshots, context });
  const agent = new ZhinAgent({ config: { outputSchema: false } });
  try {
    expect(models.chat.model.promptCacheRouting).toBe('driver');
    await agent.processTurn({ content: 'Synthetic question', message: mockCommMessage(), configuration: { models }, tools: [] });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ model: 'selected', store: false });
    expect(bodies[0].prompt_cache_key).toMatch(/^[a-f0-9]{64}$/u);
    expect(bodies[0]).not.toHaveProperty('prompt_cache_retention');
  } finally { await agent.dispose(); await models.release(); lease.release(); runtime.dispose(); }
});
