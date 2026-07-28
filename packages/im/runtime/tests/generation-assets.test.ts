import { describe, expect, it } from 'vitest';
import { childPluginId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { GenerationAssets } from '../src/generation-assets.js';

describe('GenerationAssets', () => {
  it('releases per-generation projections before shared Plugin scopes', async () => {
    const events: string[] = [];
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const projection = featureId('test.projection');
    const first = GenerationAssets.create(
      [
        [root, () => { events.push('root'); }],
        [child, () => { events.push('child'); }],
      ],
      new Map([[projection, () => { events.push('projection-1'); }]]),
    );
    const second = first.replaceProjections(
      [projection],
      new Map([[projection, () => { events.push('projection-2'); }]]),
    );

    await first.dispose();
    expect(events).toEqual(['projection-1']);

    await second.dispose();
    await second.dispose();
    expect(events).toEqual([
      'projection-1',
      'projection-2',
      'child',
      'root',
    ]);
  });

  it('replaces only selected Scope lifetimes', async () => {
    const events: string[] = [];
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const sibling = childPluginId(root, 'sibling');
    const first = GenerationAssets.create([
      [root, () => { events.push('root'); }],
      [child, () => { events.push('child-v1'); }],
      [sibling, () => { events.push('sibling'); }],
    ], new Map());
    const second = first.replaceScopes(
      [root, child, sibling],
      new Map([[child, () => { events.push('child-v2'); }]]),
      new Map(),
    );

    await first.dispose();
    expect(events).toEqual(['child-v1']);

    await second.dispose();
    expect(events).toEqual(['child-v1', 'sibling', 'child-v2', 'root']);
  });

  it('retains unchanged Feature projection lifetimes across generations', async () => {
    const events: string[] = [];
    const root = rootPluginId();
    const adapter = featureId('test.adapter');
    const command = featureId('test.command');
    const first = GenerationAssets.create(
      [[root, () => { events.push('root'); }]],
      new Map([
        [adapter, () => { events.push('adapter'); }],
        [command, () => { events.push('command-v1'); }],
      ]),
    );
    const second = first.replaceProjections(
      [command],
      new Map([[command, () => { events.push('command-v2'); }]]),
    );

    await first.dispose();
    expect(events).toEqual(['command-v1']);

    await second.dispose();
    expect(events).toEqual(['command-v1', 'command-v2', 'adapter', 'root']);
  });
});
