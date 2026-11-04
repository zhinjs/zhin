import { AIService } from '../../src/service.js';
import { createUserMessage } from '@zhin.js/ai';
import { modelRuntimeFixture } from '../helpers/model-runtime.js';

it('prepares only Host execution ports without reading a graph or constructing a Provider', async () => {
  const service = new AIService(), f = modelRuntimeFixture();
  expect(service.isReady()).toBe(false); expect(() => service.getModelRuntime()).toThrow('not prepared');
  await service.prepareModelRuntime(f.runtimeOptions);
  expect(service.isReady()).toBe(true); expect(f.calls.reads).toBe(0); expect(f.calls.factories).toBe(0);
  expect(service).not.toHaveProperty('getProvider'); expect(service).not.toHaveProperty('registerProvider');
  await service.dispose();
});

it('retains role nickname, MCP and permissions outside model resource configuration', async () => {
  const authority = { nickname: 'Z', mcpServers: ['readonly'], permission: { task: { '*': 'deny' } } };
  const service = new AIService({ agents: { zhin: authority, reviewer: { nickname: 'Reviewer' } } });
  expect(service.getBindingRegistry().requireZhinBinding()).toMatchObject(authority);
  expect(service.getBindingRegistry().requireZhinBinding()).not.toHaveProperty('model');
  expect(service.getBindingRegistry().getBinding('reviewer')).toMatchObject({ nickname: 'Reviewer' });
  await service.dispose();
});

it.each(['providers', 'modelCatalog', 'modelPolicy', 'defaultProvider', 'decisions'])('rejects old %s authority and requires explicit reviewed migration', key => {
  expect(() => new AIService({ [key]: {} })).toThrow('migration required');
});

it('rejects old role model selectors instead of inferring another binding', () => {
  for (const key of ['provider', 'model', 'preset']) {
    expect(() => new AIService({ agents: { zhin: { [key]: 'legacy-selection' } } })).toThrow(`agents.zhin.${key}`);
  }
});

it('coalesces preparation and refuses new acquisition after shutdown', async () => {
  const service = new AIService(), f = modelRuntimeFixture();
  const first = service.prepareModelRuntime(f.runtimeOptions), second = service.prepareModelRuntime(f.runtimeOptions);
  expect(first).toBe(second); await first;
  const runtime = service.getModelRuntime(); await service.dispose(); await service.dispose();
  await expect(service.prepareModelRuntime(f.runtimeOptions)).rejects.toThrow('disposed');
  const lease = f.snapshots.acquire();
  await expect(runtime.acquireForContext({ lease, snapshots: f.snapshots, context: { rootId: 'root', ownerId: 'host:test', hostOwnerId: 'host:test', operationId: 'closed' } })).rejects.toThrow('not-prepared');
  lease.release();
});

it('does not abort or release an already borrowed operation when the Agent service retires', async () => {
  const service = new AIService(), f = modelRuntimeFixture(); await service.prepareModelRuntime(f.runtimeOptions);
  const lease = f.snapshots.acquire();
  const scope = await service.getModelRuntime().acquireForContext({ lease, snapshots: f.snapshots,
    context: { rootId: 'root', ownerId: 'host:test', hostOwnerId: 'host:test', operationId: 'retained' } });
  await service.dispose();
  const result = await scope.chat.completion.complete(scope.chat.model, { messages: [createUserMessage('still active')], systemPrompt: '' });
  expect(result.content).toContainEqual({ type: 'text', text: 'done' });
  await expect(scope.inference.list({ kind: 'language' })).resolves.toHaveLength(1);
  await scope.release(); lease.release();
});

it('standalone agents use only their explicit borrowed scope and leave its cleanup to the caller', async () => {
  const service = new AIService(), f = modelRuntimeFixture(), scope = await f.acquire();
  const release = vi.spyOn(scope, 'release');
  const agent = service.createAgent({ models: scope, maxIterations: 1 });
  await agent.run('synthetic task'); agent.dispose();
  expect(release).not.toHaveBeenCalled();
  await scope.release(); expect(release).toHaveBeenCalledOnce();
  await service.dispose();
});
