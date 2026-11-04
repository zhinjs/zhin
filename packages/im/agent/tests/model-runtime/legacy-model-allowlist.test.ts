import { compileLegacyInferenceMigration, type LegacyInferenceMigrationOptions } from '../../src/migration/provider-plan.js';

const resolveService: LegacyInferenceMigrationOptions['resolveService'] = input => ({ driver: { id: 'fixture', owner: 'root/providers', contractVersion: '1' }, authentication: 'none', options: input.options,
  models: Object.fromEntries(input.models.map(model => [model.id, { id: model.id, kinds: ['language'], protocol: 'fixture', input: ['text'] }])) });
const source = { id: 'config', revision: 'metadata-v1', rootId: 'root' }, target = { rootId: 'root', hostOwnerId: 'host' };
const compile = (config: unknown) => compileLegacyInferenceMigration({ source, target, config, resolveService });

it.each(['binding', 'perception', 'perception-fallback'])('rejects %s outside the explicit allowlist in offline review', route => {
  const config = { providers: { main: { sdk: 'fixture', models: ['allowed'] } }, agents: { zhin: { provider: 'main', model: route === 'binding' ? 'other' : 'allowed' } },
    ...(route === 'binding' ? {} : { multimodal: { perception: { provider: 'main', model: route === 'perception' ? 'other' : 'allowed', ...(route === 'perception-fallback' ? { fallbacks: [{ provider: 'main', model: 'other' }] } : {}) } } }) };
  const result = compile(config); expect(result.blocked.some(item => item.code === 'model-outside-allowlist')).toBe(true);
  const serialized = JSON.stringify(result.plan.profiles); expect(serialized).not.toContain('"model":"other"');
});

it.each([undefined, []])('preserves explicit model selection when no nonempty allowlist exists (%j)', models => {
  const config = { providers: { main: { sdk: 'fixture', ...(models ? { models } : {}) } }, agents: { zhin: { provider: 'main', model: 'explicit-model' } } };
  const result = compile(config); expect(result.blocked).toEqual([]);
  expect(result.plan.profiles).toMatchObject({ 'profile:legacy%3Aagent%3Azhin': { model: 'explicit-model' } });
});

it('uses only the selected source snapshot and never consults a registered SDK instance or ambient directory', () => {
  const sourceConfig = { providers: { main: { sdk: 'fixture', models: ['one'] } }, agents: { zhin: { provider: 'main', model: 'one' } } };
  const result = compile(sourceConfig); sourceConfig.providers.main.models.push('two');
  expect(JSON.stringify(result.plan)).not.toContain('two'); expect(Object.isFrozen(result.plan)).toBe(true);
});

it('preserves the legacy SDK whitespace normalization without discovering other model IDs', () => {
  const result = compile({ providers: { main: { sdk: 'fixture', models: [' allowed ', ''] } }, agents: { zhin: { provider: 'main', model: ' allowed ' } } });
  expect(result.blocked).toEqual([]);
  expect(result.plan.profiles).toMatchObject({ 'profile:legacy%3Aagent%3Azhin': { model: 'allowed' } });
  expect(JSON.stringify(result.plan.services)).not.toContain(' allowed ');
});
