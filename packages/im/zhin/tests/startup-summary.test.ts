import { describe, expect, it } from 'vitest';
import { Feature, type FeatureJSON } from '@zhin.js/kernel';
import { Plugin } from '@zhin.js/core';
import { collectPluginFeatureRows } from '../src/setup/startup-summary.js';

class StubFeature extends Feature<{ id: string }> {
  readonly name: string;
  readonly icon = 'Box';
  readonly desc = 'stub';

  constructor(name: string) {
    super();
    this.name = name;
  }

  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : this.items;
    return { name: this.name, icon: this.icon, desc: this.desc, count: list.length, items: list };
  }
}

describe('collectPluginFeatureRows', () => {
  it('builds per-plugin feature counts', () => {
    const root = new Plugin('/test/root.ts');
    const child = new Plugin('@zhin.js/plugin-demo', root);

    const command = new StubFeature('command');
    command.add({ id: 'a' }, child.name);
    command.add({ id: 'b' }, child.name);
    root.provide(command);

    const { columns, rows } = collectPluginFeatureRows(root);
    expect(columns.some((c) => c.key === '命令')).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.plugin).toBe('plugin-demo');
    expect(rows[0]?.['命令']).toBe(2);
  });
});
