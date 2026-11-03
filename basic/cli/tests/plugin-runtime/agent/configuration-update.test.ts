import { ModelRuntimeService, modelRuntimeBaselineToken, type ModelRuntimeConfig } from '@zhin.js/agent/model-runtime';
import { ConfigValidationError, createEnvStore, type RootConfigUpdateHandler } from '@zhin.js/runtime';
import { rootPluginId, type RuntimeSnapshot, type Token } from '@zhin.js/plugin-runtime';
import { createModelConfigurationUpdateHandler } from '../../../src/plugin-runtime/agent/configuration-update.js';
import { hostModelOwnerId } from '../../../src/plugin-runtime/personal-models/host-identity.js';

const projectRoot = '/model-update-handler';
function config(): ModelRuntimeConfig {
  return { providers: { main: { sdk: 'openai-compatible', baseUrl: '${SYNTHETIC_URL}', apiKey: '${SYNTHETIC_KEY}', models: ['old', 'next'] } },
    agents: { zhin: { provider: 'main', model: 'old', permission: { task: { '*': 'deny' } } } } };
}
function fixture(initial: ModelRuntimeConfig = config()) {
  const env = createEnvStore(rootPluginId(), { name: 'test', mode: 'test', platform: 'node' }, { base: { SYNTHETIC_URL: 'https://synthetic.invalid/v1', SYNTHETIC_KEY: 'synthetic-key' } });
  const runtime = new ModelRuntimeService({ config: env.expandMissingAsEmpty(initial), hostOwnerId: hostModelOwnerId(projectRoot) });
  const current: RuntimeSnapshot = { generation: 1, root: rootPluginId(), tree: new Map(), config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map() };
  const resources = new Map<Token<unknown>, unknown>([[modelRuntimeBaselineToken, runtime]]);
  const input: Parameters<RootConfigUpdateHandler['prepare']>[0] = { current, previous: { ai: initial }, next: { ai: initial }, desired: { ai: initial }, signal: new AbortController().signal,
    readRootResource: <T>(token: Token<T>) => resources.get(token) as T | undefined,
    expand: <T>(value: T) => env.expandMissingAsEmpty(value),
    hasEnvironmentValue: name => Boolean(env.get(name)),
    environmentValueIsCurrent: () => true,
  };
  return { initial, runtime, input, handler: createModelConfigurationUpdateHandler(initial, projectRoot) };
}

it.each(['interpolation', 'secret-reference'] as const)('keeps a model group pending when %s needs an unapplied environment value', async kind => {
  const f = kind === 'interpolation' ? fixture() : fixture({
    modelCatalog: {
      connections: { main: { sdk: 'openai-compatible', revision: 1, baseUrl: '${SYNTHETIC_URL}', secretRef: 'env://SYNTHETIC_KEY' } },
      models: { old: { connectionId: 'main', model: 'old', capabilities: { input: ['text'] } } },
      presets: { main: { modelId: 'old' } },
    }, modelPolicy: { defaults: { chat: 'main' } }, agents: { zhin: { preset: 'main' } },
  });
  const desiredEnv = createEnvStore(rootPluginId(), { name: 'test', mode: 'test', platform: 'node' }, { base: {
    SYNTHETIC_URL: 'https://synthetic.invalid/v1', SYNTHETIC_KEY: 'synthetic-key', NEW_KEY: 'synthetic-new-key',
  } });
  const nextConfig: ModelRuntimeConfig = kind === 'interpolation'
    ? { ...f.initial, providers: { main: { ...f.initial.providers!.main, apiKey: '${NEW_KEY}' } } }
    : { ...f.initial, modelCatalog: { ...f.initial.modelCatalog!, connections: {
      main: { ...f.initial.modelCatalog!.connections.main, secretRef: 'env://NEW_KEY' },
    } } };
  const next = { ai: nextConfig };
  try {
    expect(() => f.handler.validate?.({ ...f.input, next, expand: value => desiredEnv.expandMissingAsEmpty(value),
      hasEnvironmentValue: name => Boolean(desiredEnv.get(name)) })).not.toThrow();
    expect(await f.handler.prepare({ ...f.input, next, desired: next })).toMatchObject({
      effect: 'restart-process', reasonCode: 'model-environment-pending',
    });
    expect((await f.runtime.resolveForTurn({ rootId: projectRoot, ownerId: hostModelOwnerId(projectRoot) })).chat.model.model).toBe('old');
    expect(() => f.handler.validate?.({ ...f.input, next })).toThrow(ConfigValidationError);
  } finally { await f.runtime.dispose(); }
});

it('keeps a same-name environment rotation pending but permits independent model changes', async () => {
  const f = fixture();
  const next = { ai: { ...f.initial, agents: { zhin: { ...f.initial.agents!.zhin, model: 'next' } } } };
  try {
    expect(await f.handler.prepare({ ...f.input, next, desired: next,
      environmentValueIsCurrent: name => name !== 'SYNTHETIC_KEY' }))
      .toMatchObject({ effect: 'restart-process', reasonCode: 'model-environment-pending' });
    expect(await f.handler.prepare({ ...f.input, next, desired: next,
      environmentValueIsCurrent: name => name !== 'UNRELATED_SETTING' })).toHaveProperty('effect', 'replace-resource');
  } finally { await f.runtime.dispose(); }
});

it('preserves environment fallback syntax and ignores unrelated non-model authority references', async () => {
  const f = fixture();
  try {
    const next = { ai: { ...f.initial, providers: { main: { ...f.initial.providers!.main, apiKey: '${MISSING_KEY:-synthetic-fallback}' } } } };
    const desired = { ai: { ...next.ai, personalPrincipals: { '${NOT_A_MODEL_VALUE}': [] } } };
    expect(() => f.handler.validate?.({ ...f.input, next: desired })).not.toThrow();
    // Permission/identity configuration is outside the handler's declared paths.
    expect(await f.handler.prepare({ ...f.input, next, desired }))
      .toHaveProperty('effect', 'replace-resource');
  } finally { await f.runtime.dispose(); }
});

it('validates complete desired model references with the Root environment before startup bindings exist', async () => {
  const f = fixture();
  try {
    expect(() => f.handler.validate?.({ ...f.input, readRootResource: () => undefined })).not.toThrow();
    expect(() => f.handler.validate?.({ ...f.input, next: { ai: { ...f.initial, agents: { zhin: { provider: 'missing', model: 'old' } } } } })).toThrow();
    expect(() => f.handler.validate?.({ ...f.input, next: { ai: undefined } })).not.toThrow();
  } finally { await f.runtime.dispose(); }
});

it('prepares an unexposed immutable private model binding and preserves unrelated AI authority', async () => {
  const f = fixture();
  try {
    const prepared = await f.handler.prepare({ ...f.input, next: { ai: { ...f.initial, agents: { zhin: { ...f.initial.agents!.zhin, model: 'next' } } } } });
    expect(prepared?.effect).toBe('replace-resource');
    if (prepared?.effect !== 'replace-resource') throw new Error('expected prepared model binding');
    const next = prepared.rootResources.get(modelRuntimeBaselineToken);
    expect(next).toBeInstanceOf(ModelRuntimeService);
    if (!(next instanceof ModelRuntimeService)) throw new Error('expected model configuration');
    const turn = { rootId: projectRoot, ownerId: hostModelOwnerId(projectRoot) };
    expect((await next.resolveForTurn(turn)).chat.model.model).toBe('next');
    expect((await f.runtime.resolveForTurn(turn)).chat.model.model).toBe('old');
    expect(f.handler.paths).not.toContainEqual(['ai', 'agents', 'zhin', 'permission']);
    expect(JSON.stringify(next.getCatalogConfig())).not.toContain('synthetic-key');
  } finally { await f.runtime.dispose(); }
});

it('reports a concrete restart reason for destructive changes without closing the old model view', async () => {
  const f = fixture();
  try {
    const next = { ...f.initial, providers: { main: { ...f.initial.providers!.main, models: ['old'] } } };
    const result = await f.handler.prepare({ ...f.input, next: { ai: next } });
    expect(result).toMatchObject({ effect: 'restart-process', reasonCode: expect.stringContaining('removed-models') });
    expect((await f.runtime.resolveForTurn({ rootId: projectRoot, ownerId: hostModelOwnerId(projectRoot) })).chat.model.model).toBe('old');
  } finally { await f.runtime.dispose(); }
});

it('keeps model changes pending when the full desired configuration disables Agent or adds binding authority', async () => {
  const f = fixture();
  try {
    const next = { ai: { ...f.initial, agents: { zhin: { ...f.initial.agents!.zhin, model: 'next' } } } };
    expect(await f.handler.prepare({ ...f.input, next, desired: { ai: { ...next.ai, enabled: false } } }))
      .toMatchObject({ effect: 'restart-process', reasonCode: 'agent-installation-changed' });
    expect(await f.handler.prepare({ ...f.input, next, desired: { ai: undefined } }))
      .toMatchObject({ effect: 'restart-process', reasonCode: 'agent-installation-changed' });
    expect(await f.handler.prepare({ ...f.input, next, desired: { ai: { ...next.ai, agents: { ...next.ai.agents,
      reviewer: { provider: 'main', model: 'next', permission: { task: { '*': 'allow' } } } } } } }))
      .toMatchObject({ effect: 'restart-process', reasonCode: 'model-binding-topology-changed' });
    expect((await f.runtime.resolveForTurn({ rootId: projectRoot, ownerId: hostModelOwnerId(projectRoot) })).chat.model.model).toBe('old');
  } finally { await f.runtime.dispose(); }
});
