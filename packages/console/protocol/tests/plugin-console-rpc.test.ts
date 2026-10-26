import { expect, it } from 'vitest';
import { parsePluginConsoleRpcType, pluginConsoleRpcType } from '../src/index.js';

it('builds and parses plugin.<pluginId>.<method> names', () => {
  expect(pluginConsoleRpcType('root/typesafe', 'status')).toBe('plugin.root/typesafe.status');
  expect(parsePluginConsoleRpcType('plugin.root/a/b-c.reset-cooldown')).toEqual({ pluginId: 'root/a/b-c', method: 'reset-cooldown' });
  expect(parsePluginConsoleRpcType('plugin.root.status')).toEqual({ pluginId: 'root', method: 'status' });
});

it('rejects anything that is not a well-formed plugin Console RPC', () => {
  for (const type of ['plugin:inspect', 'plugin.typesafe.status', 'plugin.root/A.status', 'plugin.root/a.Status',
    'plugin.root/a', 'plugin.root//a.status', 'plugin.root/a.status.x', `plugin.root/${'a'.repeat(700)}.status`, 42, null]) {
    expect(parsePluginConsoleRpcType(type)).toBeNull();
  }
  expect(() => pluginConsoleRpcType('typesafe', 'status')).toThrow(TypeError);
});

it('parses pathological input in linear time', () => {
  const started = performance.now();
  parsePluginConsoleRpcType(`plugin.root${'/a'.repeat(300)}.`);
  expect(performance.now() - started).toBeLessThan(50);
});
