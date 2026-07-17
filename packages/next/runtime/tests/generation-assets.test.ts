import { describe, expect, it } from 'vitest';
import { childPluginId, rootPluginId } from '@zhin.js/next-kernel';
import { GenerationAssets } from '../src/generation-assets.js';

describe('GenerationAssets', () => {
  it('releases per-generation projections before shared Plugin scopes', async () => {
    const events: string[] = [];
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const first = GenerationAssets.create(
      [
        [root, () => { events.push('root'); }],
        [child, () => { events.push('child'); }],
      ],
      [() => { events.push('projection-1'); }],
    );
    const second = first.fork([
      () => { events.push('projection-2'); },
    ]);

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
    ], []);
    const second = first.replaceScopes(
      [root, child, sibling],
      new Map([[child, () => { events.push('child-v2'); }]]),
      [],
    );

    await first.dispose();
    expect(events).toEqual(['child-v1']);

    await second.dispose();
    expect(events).toEqual(['child-v1', 'sibling', 'child-v2', 'root']);
  });
});
