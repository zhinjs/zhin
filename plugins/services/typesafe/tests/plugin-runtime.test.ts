import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { ConfigComposer, ConfigValidationError, NodePackageResolver, ProjectGraphService } from '../../../../packages/im/runtime/src/index.js';
import { Scope, DisposeStack, GenerationHandoffStack, childPluginId, rootPluginId, type PluginSetupContext } from 'zhin.js';
import { decisionProviderToken } from '@zhin.js/agent/runtime';
import plugin from '../plugin.js';
import type { TypeSafeDecisionConfig } from '../src/decision-provider.js';

it('composes the real plugin schema and host decision references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-typesafe-config-'));
  try {
    const child = join(directory, 'plugins/typesafe');
    await mkdir(child, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@test/root', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', plugins: [{ package: './plugins/typesafe', instanceKey: 'typesafe' }] } }));
    await writeFile(join(child, 'package.json'), JSON.stringify({ name: '@test/typesafe', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    await writeFile(join(child, 'schema.json'), await readFile(new URL('../schema.json', import.meta.url), 'utf8'));
    const graph = await new ProjectGraphService(await NodePackageResolver.create(directory)).inspect(directory);
    const composer = new ConfigComposer();
    const disabled = await composer.compose(graph, { plugins: { typesafe: { enabled: false } } });
    expect(disabled.views.get(graph.root.children[0]!.id)).toMatchObject({ enabled: false, model: 'jev-latest', timeoutMs: 10000 });
    await expect(composer.compose(graph, { plugins: { typesafe: {} } })).rejects.toBeInstanceOf(ConfigValidationError);
    for (const config of [
      { apiKey: ' \t\n' },
      { apiKey: 'test-key', model: '  ' },
      ...['https://user:password@example.com', 'https://@example.com', 'https://example.com?token=private', 'https://example.com#fragment', 'https://example.com?', 'https://example.com#', 'https://exa mple.com'].map(baseUrl => ({ apiKey: 'test-key', baseUrl })),
    ]) {
      await expect(composer.compose(graph, { plugins: { typesafe: config } })).rejects.toBeInstanceOf(ConfigValidationError);
    }
    const enabled = await composer.compose(graph, {
      plugins: { typesafe: { apiKey: 'test-key' } },
      ai: { decisions: { provider: 'root/typesafe', skills: { mode: 'shadow' } } },
    });
    expect(enabled.views.get(graph.root.children[0]!.id)).toMatchObject({ apiKey: 'test-key', model: 'jev-latest' });
    await expect(composer.compose(graph, {
      plugins: { typesafe: { apiKey: 'test-key' } },
      ai: { decisions: { provider: 'root/typesafe', skills: { mode: 'invalid' } } },
    })).rejects.toBeInstanceOf(ConfigValidationError);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('fails enabled setup on invalid config instead of silently removing the configured provider', async () => {
  const { context, resources, lifecycle } = setupContext({ apiKey: '${TYPESAFE_API_KEY}' });
  await expect(async () => plugin.setup!(context)).rejects.toMatchObject({ code: 'invalid-config', message: 'TypeSafe decision invalid-config' });
  expect(resources.has(decisionProviderToken)).toBe(false);
  await lifecycle.dispose();
});

function setupContext(config: TypeSafeDecisionConfig) {
  const root = rootPluginId();
  const owner = childPluginId(root, 'typesafe');
  const parent = new Scope(root);
  const resources = new Scope(owner, parent);
  const lifecycle = new DisposeStack();
  const context: PluginSetupContext<TypeSafeDecisionConfig> = {
    signal: new AbortController().signal,
    plugin: { id: owner, instanceKey: 'typesafe', root, parent: root, role: 'child' },
    config: { get: () => config }, resources, lifecycle,
    handoff: new GenerationHandoffStack(), addFeature() {},
  };
  return { context, parent, resources, lifecycle };
}

it('provides only a local resource and aborts the pending call on generation cleanup', async () => {
  let transportSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    transportSignal = init?.signal ?? undefined;
    transportSignal?.addEventListener('abort', () => reject(new Error('fake fetch cancelled')), { once: true });
  })));
  const { context, parent, resources, lifecycle } = setupContext({ apiKey: 'test-key' });
  try {
    await plugin.setup!(context);
    expect(parent.has(decisionProviderToken)).toBe(false);
    expect(resources.has(decisionProviderToken)).toBe(true);
    const registration = resources.use(decisionProviderToken);
    expect(registration.owner).toBe(context.plugin.id);
    const provider = registration.provider;
    const pending = provider.evaluate({ state: 'test', questions: { allowed: { type: 'noul' } } }, { signal: context.signal });
    await lifecycle.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'disposed' });
    expect(transportSignal?.aborted).toBe(true);
  } finally { vi.unstubAllGlobals(); await lifecycle.dispose(); }
});

it('disabled setup does not create a resource or issue a request', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const { context, resources, lifecycle } = setupContext({ enabled: false, apiKey: '' });
  try {
    await plugin.setup!(context);
    expect(resources.has(decisionProviderToken)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); await lifecycle.dispose(); }
});
