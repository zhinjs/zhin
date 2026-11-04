import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigComposer, ConfigValidationError, NodePackageResolver, ProjectGraphService } from '../../../../packages/im/runtime/src/index.js';
import { Scope, DisposeStack, GenerationHandoffStack, childPluginId, rootPluginId, type PluginSetupContext } from 'zhin.js';
import { aiProviderDefinitionsToken } from '@zhin.js/ai-provider';
import plugin from '../plugin.js';
import { typeSafeProvider } from '../src/provider.js';
import { driverFixture, callContext } from '../../../../packages/im/ai/tests/providers/fixtures.js';
import Ajv from 'ajv';

it('describes the same TypeSafe budgets and structural inputs that the Driver actually validates', () => {
  const ajv = new Ajv({ strict: false, validateFormats: false });
  const service = ajv.compile(typeSafeProvider.serviceSchema.inputSchema!);
  const schema = typeSafeProvider.profileSchema({ service: { id: 'service', rootId: 'root', ownerId: 'host', revision: 1,
    driver: { id: 'typesafe', owner: 'root', contractVersion: '1' }, options: typeSafeProvider.serviceSchema.parse({}), models: {} },
    model: { id: 'selected', protocol: 'typesafe-system-one', kinds: ['decision'] } });
  const profile = ajv.compile(schema.inputSchema!);
  for (const value of [{}, { baseUrl: 'https://provider.example' }]) {
    expect(service(value)).toBe(true); expect(() => typeSafeProvider.serviceSchema.parse(value)).not.toThrow();
  }
  for (const value of [{}, { timeoutMs: 1, maxRetries: 0 }, { timeoutMs: 2_147_483_647, maxRetries: 10 }]) {
    expect(profile(value)).toBe(true); expect(() => schema.parse(value)).not.toThrow();
  }
  for (const value of [{ maxRetries: 11 }, { timeoutMs: 0 }, { maxRetries: 1.5 }, { temperature: 1 }]) {
    expect(profile(value)).toBe(false); expect(() => schema.parse(value)).toThrow();
  }
  expect(typeSafeProvider.modelContracts).toEqual([{ protocol: 'typesafe-system-one', kinds: ['decision'] }]);
});

it('composes a credential-free Provider plugin and rejects the removed plugin-owned account configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-typesafe-config-'));
  try {
    const child = join(directory, 'plugins/typesafe');
    await mkdir(child, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@test/root', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', plugins: [] } }));
    await writeFile(join(child, 'package.json'), JSON.stringify({ name: '@test/typesafe', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    await writeFile(join(child, 'schema.json'), await readFile(new URL('../schema.json', import.meta.url), 'utf8'));
    const config = { configVersion: 2, plugins: { typesafe: './plugins/typesafe' } };
    const graph = await new ProjectGraphService(await NodePackageResolver.create(directory)).inspect(directory, config);
    const composer = new ConfigComposer();
    const composed = await composer.compose(graph, config);
    expect(composed.views.get(graph.root.children[0]!.id)).toEqual({});
    for (const old of [{ apiKey: 'synthetic' }, { model: 'jev-latest' }, { enabled: false }]) {
      await expect(composer.compose(graph, { ...config, typesafe: old })).rejects.toBeInstanceOf(ConfigValidationError);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('publishes a local Driver declaration without credentials or network access at setup', async () => {
  const root = rootPluginId(), owner = childPluginId(root, 'typesafe');
  const parent = new Scope(root), resources = new Scope(owner, parent), lifecycle = new DisposeStack();
  const context: PluginSetupContext = {
    signal: new AbortController().signal,
    plugin: { id: owner, instanceKey: 'typesafe', root, parent: root, role: 'child' },
    config: { get: () => ({}) }, resources, lifecycle,
    handoff: new GenerationHandoffStack(), addFeature() {},
  };
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  try {
    await plugin.setup!(context);
    expect(parent.has(aiProviderDefinitionsToken)).toBe(false);
    expect(resources.use(aiProviderDefinitionsToken)).toEqual([{ owner, definition: typeSafeProvider }]);
    expect(fetch).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); await lifecycle.dispose(); }
});

it('selects the configured Decision profile and sends real Choice/Score/Noul through the official SDK', async () => {
  const requests: Request[] = [];
  const fixture = driverFixture({ definition: typeSafeProvider,
    model: { id: 'jev-selected', kinds: ['decision'], protocol: 'typesafe-system-one' }, parameters: { maxRetries: 0 },
    fetch: async (url, init) => { requests.push(new Request(url, init)); return Response.json({ model: 'jev-pinned', usage: { input_tokens: 3, output_tokens: 2 }, answers: {
      route: { type: 'choice', choice: 'yes', confidence: 1, probabilities: { yes: 1 } },
      score: { type: 'score', score: 0.75, confidence: 0.8, legend: { '0': 'bad', '1': 'good' }, probabilities: { '0': 0.25, '1': 0.75 } },
      allowed: { type: 'noul', noul: 0.9 },
    } }); },
  });
  const client = await fixture.runtime.openOperation({ context: callContext });
  try {
    const profile = (await client.list({ kind: 'decision' }))[0].reference;
    const result = await client.evaluate({ profile, state: { text: 'synthetic' }, questions: {
      route: { type: 'choice', criteria: { yes: null } }, score: { type: 'score', criteria: ['bad', 'good'] }, allowed: { type: 'noul' },
    } });
    expect(result.answers.route.choice).toBe('yes'); expect(result.answers.score.score).toBe(0.75); expect(result.answers.allowed.noul).toBe(0.9);
    expect(result.model).toBe('jev-pinned'); expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    expect(requests[0].url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(requests[0].headers.get('authorization')).toBe('Bearer synthetic-key');
    expect((await requests[0].json()).model).toBe('jev-selected');
    expect(fixture.authorize).toHaveBeenCalledTimes(2);
  } finally { await client.close(); }
});
