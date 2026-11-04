import { compileLegacyInferenceMigration, compileLegacySessionSelection, type LegacyInferenceMigrationOptions } from '../../src/migration/provider-plan.js';
import { createEmptyProviderGraph, reviewProviderPlan } from '@zhin.js/ai/provider';

const source = { id: 'startup-config', rootId: 'root', revision: 'sha256:synthetic-source-version' };
const target = { rootId: 'root', hostOwnerId: 'host' };
const resolver: LegacyInferenceMigrationOptions['resolveService'] = input => ({
  driver: { id: input.sdk, owner: 'root/providers', contractVersion: '1' }, options: input.options,
  authentication: input.sdk === 'local' ? 'none' : 'api-key', parameters: input => input.parameters,
  models: Object.fromEntries(input.models.map(model => [model.id, { id: model.id, kinds: [model.requiredKind ?? 'language'], protocol: 'fixture',
    input: model.input?.filter(value => value === 'text' || value === 'image') ?? ['text'],
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}), ...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}), streaming: true }])),
});
const compile = (config: unknown, extra: Partial<LegacyInferenceMigrationOptions> = {}) => compileLegacyInferenceMigration({ source, target, config, resolveService: resolver, ...extra });

it('creates only aliases and a reviewable plan, preserving explicit models, roles, perception order and omitted summary inheritance', async () => {
  const preview = compile({ providers: { main: { sdk: 'local', defaultModel: 'chat', models: ['chat'] }, vision: { sdk: 'fixture', models: ['first', 'second'], input: ['text', 'image'], apiKey: '${VISION_KEY}' } },
    agents: { zhin: { provider: 'main' }, reviewer: { provider: 'main', model: 'chat', nickname: 'Reviewer', permission: { task: 'deny' } } },
    multimodal: { perception: { provider: 'vision', model: 'first', fallbacks: [{ provider: 'vision', model: 'second' }] } } });
  expect(preview.blocked).toEqual([]);
  expect(preview.credentials).toEqual([{ accountAlias: 'account:vision', source: { kind: 'environment', reference: 'env://VISION_KEY' } }]);
  let sequence = 0;
  const reviewed = await reviewProviderPlan({ input: preview.plan, graph: createEmptyProviderGraph('root'), ownerId: 'host', hostOwnerId: 'host', createId: kind => `${kind}:${++sequence}`,
    resolveService: value => ({ driver: typeof value.driver === 'string' ? { id: value.driver, owner: 'root/providers', contractVersion: '1' } : value.driver, options: value.options, models: value.models }) });
  expect(reviewed.graph.purposes.defaults.summary).toBeUndefined();
  expect(reviewed.graph.purposes.defaults.perception?.fallbacks).toHaveLength(1);
  expect(reviewed.graph.purposes.agents?.reviewer).toBeDefined();
  expect(JSON.stringify(preview.plan)).not.toMatch(/nickname|permission|VISION_KEY.*apiKey/);
  expect(Object.keys(reviewed.graph.accounts)).toHaveLength(2);
});

it('keeps secrets and private headers out of output, retaining only explicit private source locators', () => {
  const result = compile({ providers: { main: { sdk: 'fixture', models: ['chat'], apiKey: 'synthetic-private-key', headers: { Authorization: 'synthetic-private-header' } } }, agents: { zhin: { provider: 'main', model: 'chat' } } });
  expect(JSON.stringify(result)).not.toMatch(/synthetic-private-key|synthetic-private-header/);
  expect(result.credentials).toEqual([{ accountAlias: 'account:main', source: { kind: 'legacy-config', path: 'providers.main.apiKey' } }]);
  expect(result.blocked).toContainEqual({ path: 'providers.main.headers', code: 'private-header-mapping-required' });
});

it('does not guess a model or widen an explicit allowlist', () => {
  expect(compile({ providers: { main: { sdk: 'local' } }, agents: { zhin: { provider: 'main' } } }).blocked).toContainEqual({ path: 'profiles.legacy:agent:zhin', code: 'model-selection-required' });
  const result = compile({ providers: { main: { sdk: 'local', models: ['allowed'] } }, agents: { zhin: { provider: 'main', model: 'other' } } });
  expect(result.blocked).toContainEqual({ path: 'profiles.legacy:agent:zhin', code: 'model-outside-allowlist' });
});

it('requires exact owner/root, identity and Driver mappings instead of borrowing stale data by alias', () => {
  const config = { modelCatalog: { connections: { main: { id: 'main', ownerId: 'alice', sdk: 'fixture', secretRef: 'vault:opaque-record' } }, models: {}, presets: {} } };
  expect(compile(config).blocked).toContainEqual({ path: 'modelCatalog.connections.main.ownerId', code: 'owner-mapping-required' });
  expect(compile({}, { source: { ...source, rootId: 'another-host' } }).blocked).toContainEqual({ path: 'source.rootId', code: 'root-mapping-required' });
  expect(compile({ providers: { main: { sdk: 'fixture' } } }, { resolveService: () => undefined }).blocked).toContainEqual({ path: 'providers.main', code: 'driver-selection-required' });
  expect(compile({ providers: { main: { id: 'other', sdk: 'fixture' } } }).blocked).toContainEqual({ path: 'providers.main.id', code: 'identity-conflict' });
});

it('preserves strict catalog metadata and parameters without inheriting unrelated provider aliases', () => {
  const config = { modelCatalog: {
    connections: { explicit: { id: 'explicit', ownerId: 'host', sdk: 'fixture', baseUrl: 'https://selected.test/v1', secretRef: 'vault:opaque-record' } },
    models: { native: { id: 'native', connectionId: 'explicit', model: 'selected', capabilities: { input: ['text', 'image'] }, contextWindow: 16000, maxOutputTokens: 100 } },
    presets: { chosen: { id: 'chosen', modelId: 'native', temperature: 0.3 } },
  }, modelPolicy: { defaults: { chat: 'chosen', summary: 'chosen' } } };
  const before = structuredClone(config), result = compile(config);
  expect(result.blocked).toEqual([]); expect(config).toEqual(before);
  expect(result.plan.profiles).toMatchObject({ 'profile:chosen': { account: 'account:explicit', model: 'selected', parameters: { temperature: 0.3 } } });
  expect(result.credentials).toEqual([{ accountAlias: 'account:explicit', source: { kind: 'legacy-vault', reference: 'vault:opaque-record' } }]);
  expect(Object.isFrozen(result.plan)).toBe(true);
});

it('requires structural scope identity mapping and explicit choice for old ambient candidate chains', () => {
  const result = compile({ modelPolicy: { endpoints: [{ address: { endpoint: 'old-name' }, models: { chat: 'old-preset' } }] }, trigger: { ambient: { judge: [{ provider: 'main', model: 'one' }, { provider: 'main', model: 'two' }] } } });
  expect(result.blocked).toContainEqual({ path: 'modelPolicy.endpoints.0.address', code: 'scope-mapping-required' });
  expect(result.blocked).toContainEqual({ path: 'trigger.ambient.judge', code: 'explicit-single-model-required' });
});

it('maps a single explicit ambient model to its independent language purpose and does not select fallback models', () => {
  const result = compile({ providers: { main: { sdk: 'local', models: ['chat', 'judge'] } }, agents: { zhin: { provider: 'main', model: 'chat' } }, trigger: { ambient: { judge: { provider: 'main', model: 'judge' } } } });
  expect(result.blocked).toEqual([]); expect(result.plan.purposes).toMatchObject({ ambient: { profile: 'profile:legacy%3Aambient' } });
});

it('migrates Session selections only through explicit actual Profile identity mappings', () => {
  const profile = { id: 'profile-id', rootId: 'root', accountId: 'account-id', accountIncarnation: 'incarnation', kind: 'language' as const };
  expect(compileLegacySessionSelection({ selection: { kind: 'inherit' }, mappings: {} })).toEqual({ kind: 'inherit' });
  expect(() => compileLegacySessionSelection({ selection: { kind: 'preset', presetId: 'chosen' }, mappings: {} })).toThrow('mapping required');
  expect(compileLegacySessionSelection({ selection: { kind: 'preset', presetId: 'chosen' }, mappings: { chosen: profile } })).toEqual({ kind: 'profile', profile });
});


it('preserves provider generation and timeout semantics in Profile defaults and applies explicit preset overrides', () => {
  const result = compile({ providers: { main: { sdk: 'fixture', models: ['chat'], temperature: 0.4, maxTokens: 321, thinkingLevel: 'low', maxRetries: 2, timeout: 1000 } }, agents: { zhin: { provider: 'main' } } });
  expect(result.blocked).toEqual([]);
  expect(result.plan.profiles).toMatchObject({ 'profile:legacy%3Aagent%3Azhin': { parameters: { temperature: 0.4, maxOutputTokens: 321, thinkingLevel: 'low', maxRetries: 2, requestTimeoutMs: 1000 } } });
  const blocked = compile({ providers: { main: { sdk: 'fixture', models: ['chat'], temperature: 0.4 } }, agents: { zhin: { provider: 'main' } } }, { resolveService: input => { const value = resolver(input)!; return { ...value, parameters: undefined }; } });
  expect(blocked.blocked.some(item => item.code === 'parameter-mapping-required')).toBe(true);
});

it('fingerprints the complete public preview including private source locators and blocked mappings', () => {
  const config = (reference: string) => ({ modelCatalog: { connections: { main: { sdk: 'fixture', secretRef: reference } }, models: {}, presets: {} } });
  expect(compile(config('vault:first')).source.fingerprint).not.toBe(compile(config('vault:second')).source.fingerprint);
  const first = compile({ providers: { main: { sdk: 'fixture', models: ['chat'], apiKey: 'private-first' } } });
  const changedPrivate = compile({ providers: { main: { sdk: 'fixture', models: ['chat'], apiKey: 'private-second' } } }, { source: { ...source, revision: 'new-private-record-revision' } });
  expect(first.source.fingerprint).not.toBe(changedPrivate.source.fingerprint);
  expect(JSON.stringify(changedPrivate)).not.toContain('private-second');
});


it('maps explicit per-provider image models and equivalent global/local image defaults without guessing a default provider', () => {
  const result = compile({ imageGeneration: { defaultSize: '1024x1024', promptSuffix: 'natural light', watermarkEnabled: false },
    providers: { images: { sdk: 'fixture', imageGeneration: { defaultModel: 'explicit-image', numSteps: 5 } } } });
  expect(result.blocked).toEqual([]);
  expect(result.plan.profiles).toMatchObject({ 'profile:legacy%3Aimage%3Aimages': { model: 'explicit-image', parameters: { imageGeneration: { defaultSize: '1024x1024', promptSuffix: 'natural light', watermarkEnabled: false, numSteps: 5 } } } });
  expect(result.plan.purposes).not.toHaveProperty('image');
  expect(compile({ imageGeneration: { defaultModel: 'unbound-image' } }).blocked).toContainEqual({ path: 'imageGeneration', code: 'image-provider-mapping-required' });
});


it('does not silently drop unknown source settings, and preserves legacy nonpositive metadata as omitted SDK defaults', () => {
  const result = compile({ providers: { main: { sdk: 'fixture', models: ['chat'], maxOutputTokens: 0, contextWindow: -1, thinkingBudget: 42 } }, agents: { zhin: { provider: 'main' } } });
  expect(result.blocked).toContainEqual({ path: 'providers.main.thinkingBudget', code: 'field-mapping-required' });
  expect(result.plan.profiles).toMatchObject({ 'profile:legacy%3Aagent%3Azhin': { parameters: {} } });
});

it('maps Workroom processing contracts to reviewed service aliases without silently reusing old alias authority', () => {
  const contract = { endpoint: 'https://processing.test/v1', processingRegions: ['local'], maxConfidentiality: 'public', external: false, noTraining: true, loggingMode: 'metadata_only', maximumRetentionSeconds: 0, allowsRedisclosure: false, supportsDeletion: true };
  const result = compile({ providers: { main: { sdk: 'local', models: ['chat'] } }, workroom: { disclosure: { modelProviders: { main: contract, missing: contract } } } });
  expect(result.workroomServiceMappings).toEqual([{ legacyProviderAlias: 'main', serviceAlias: 'service:main', contract }]);
  expect(result.blocked).toContainEqual({ path: 'workroom.disclosure.modelProviders.missing', code: 'service-mapping-required' });
  expect(result.plan).not.toHaveProperty('workroom');
});


it('retains an explicitly mapped personal owner without granting deployment-purpose authority', () => {
  const result = compileLegacyInferenceMigration({ source: { id: 'personal-source', revision: 'one', rootId: 'root' }, target: { rootId: 'root', hostOwnerId: 'host', ownerId: 'alice' },
    config: { modelCatalog: { connections: { personal: { id: 'personal', ownerId: 'alice', revision: 1, sdk: 'local', secretRef: 'vault:opaque' } }, models: { chat: { id: 'chat', connectionId: 'personal', model: 'explicit' } }, presets: { selected: { id: 'selected', modelId: 'chat' } } } },
    resolveService: () => ({ driver: { id: 'fixture', owner: 'root/providers', contractVersion: '1' }, options: {}, authentication: 'api-key', models: { explicit: { id: 'explicit', kinds: ['language'], protocol: 'fixture' } } }),
  });
  expect(result.target).toEqual({ rootId: 'root', hostOwnerId: 'host', ownerId: 'alice' });
  expect(result.plan).not.toHaveProperty('purposes');
  expect(result.blocked).not.toContainEqual(expect.objectContaining({ code: 'owner-mapping-required' }));
});


it('retains harness values only after explicit Service/native-model mappings and fingerprints those choices', () => {
  const config = { providers: { main: { sdk: 'local', models: ['native'] } }, agent: { modelHarness: { providerPatterns: { 'old-*': { maxIterations: 8 } }, models: { 'old:native': { maxIterations: 9, emptyReplyRetries: 1 } } } } };
  const missing = compile(config);
  expect(missing.blocked).toContainEqual({ path: 'agent.modelHarness.providerPatterns.old-*', code: 'harness-service-mapping-required' });
  const mapped = compile(config, { harnessTargets: {
    'agent.modelHarness.providerPatterns.old-*': [{ serviceAlias: 'service:main' }],
    'agent.modelHarness.models.old:native': [{ serviceAlias: 'service:main', model: 'native' }],
  } });
  expect(mapped.blocked).toEqual([]);
  expect(mapped.harnessServiceMappings).toEqual([
    { sourcePaths: ['agent.modelHarness.providerPatterns.old-*'], serviceAlias: 'service:main', settings: { maxIterations: 8 } },
    { sourcePaths: ['agent.modelHarness.models.old:native'], serviceAlias: 'service:main', model: 'native', settings: { maxIterations: 9, emptyReplyRetries: 1 } },
  ]);
  expect(mapped.source.fingerprint).not.toBe(missing.source.fingerprint);
  expect(compile(config, { harnessTargets: { 'agent.modelHarness.models.old:native': [{ serviceAlias: 'service:main', model: 'not-declared' }] } }).blocked).toContainEqual({ path: 'agent.modelHarness.models.old:native', code: 'harness-target-mapping-invalid' });
});


it('preserves the original provider-rule and global-model/compound-model merge precedence without guessing ambiguous collisions', () => {
  const config = { providers: { main: { sdk: 'local', models: ['native'] } }, agent: { modelHarness: {
    providerPatterns: { first: { maxIterations: 5 }, second: { maxIterations: 6, emptyReplyRetries: 1 } },
    models: { 'main:native': { maxIterations: 9 }, native: { maxIterations: 7, explorationBudget: 2 } },
  } } };
  const mapped = compile(config, { harnessTargets: {
    'agent.modelHarness.providerPatterns.first': [{ serviceAlias: 'service:main' }], 'agent.modelHarness.providerPatterns.second': [{ serviceAlias: 'service:main' }],
    'agent.modelHarness.models.main:native': [{ serviceAlias: 'service:main', model: 'native' }], 'agent.modelHarness.models.native': [{ serviceAlias: 'service:main', model: 'native' }],
  } });
  expect(mapped.blocked).toEqual([]);
  expect(mapped.harnessServiceMappings).toMatchObject([
    { settings: { maxIterations: 6, emptyReplyRetries: 1 } },
    { sourcePaths: ['agent.modelHarness.models.native', 'agent.modelHarness.models.main:native'], settings: { maxIterations: 9, explorationBudget: 2 } },
  ]);
});


it('blocks ambiguous old exact selectors mapped onto the same target instead of merging by accident', () => {
  const result = compile({ providers: { main: { sdk: 'local', models: ['native'] } }, agent: { modelHarness: {
    models: { 'alias-one': { maxIterations: 7 }, 'alias-two': { maxIterations: 9 } },
  } } }, { harnessTargets: {
    'agent.modelHarness.models.alias-one': [{ serviceAlias: 'service:main', model: 'native' }],
    'agent.modelHarness.models.alias-two': [{ serviceAlias: 'service:main', model: 'native' }],
  } });
  expect(result.harnessServiceMappings).toEqual([]);
  expect(result.blocked.filter(item => item.code === 'harness-target-collision').map(item => item.path)).toEqual([
    'agent.modelHarness.models.alias-one', 'agent.modelHarness.models.alias-two',
  ]);
});
