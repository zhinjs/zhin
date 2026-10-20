import {
  PluginConfigurationShapeError,
  readPluginConfigurationMap,
} from '../src/plugin-configuration.js';

describe('Plugin configuration contract', () => {
  it('projects top-level business blocks from the alias-to-package map', () => {
    const sandbox = { endpoints: [] };
    expect(readPluginConfigurationMap({ configVersion: 2, plugins: { sandbox: '@test/sandbox' }, sandbox })).toEqual({ sandbox });
  });

  it('treats an omitted plugins key as an empty map', () => {
    expect(readPluginConfigurationMap({ configVersion: 2 })).toEqual({});
  });

  it.each([null, [], ['@zhin.js/adapter-sandbox'], 'sandbox'])(
    'rejects non-canonical plugins value %#',
    (plugins) => {
      expect(() => readPluginConfigurationMap({ configVersion: 2, plugins }, 'zhin.config.yml'))
        .toThrow(new PluginConfigurationShapeError('zhin.config.yml'));
    },
  );

  it('does not interpret old business maps as package declarations', () => {
    expect(() => readPluginConfigurationMap({ plugins: { sandbox: {} } })).toThrow('docs/migrations/plugin-instance-declarations.md');
    expect(() => readPluginConfigurationMap({ configVersion: 2, plugins: { sandbox: {} } })).toThrow('package strings');
  });

  it('defaults only missing blocks and preserves the original values', () => {
    const sandbox = { value: false };
    expect(readPluginConfigurationMap({ configVersion: 2, plugins: { sandbox: '@test/sandbox', other: '@test/other' }, sandbox }))
      .toEqual({ sandbox, other: {} });
    expect(readPluginConfigurationMap({ configVersion: 2, plugins: { sandbox: '@test/sandbox' }, sandbox: null })).toEqual({ sandbox: null });
  });
});
