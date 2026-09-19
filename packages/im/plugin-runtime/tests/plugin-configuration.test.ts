import {
  PluginConfigurationShapeError,
  readPluginConfigurationMap,
} from '../src/plugin-configuration.js';

describe('Plugin configuration contract', () => {
  it('returns the canonical instance map', () => {
    const plugins = { sandbox: { endpoints: [] } };
    expect(readPluginConfigurationMap({ plugins })).toBe(plugins);
  });

  it('treats an omitted plugins key as an empty map', () => {
    expect(readPluginConfigurationMap({})).toEqual({});
  });

  it.each([null, [], ['@zhin.js/adapter-sandbox'], 'sandbox'])(
    'rejects non-canonical plugins value %#',
    (plugins) => {
      expect(() => readPluginConfigurationMap({ plugins }, 'zhin.config.yml'))
        .toThrow(new PluginConfigurationShapeError('zhin.config.yml'));
    },
  );
});
