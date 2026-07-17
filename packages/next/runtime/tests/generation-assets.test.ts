import { describe, expect, it } from 'vitest';
import { GenerationAssets } from '../src/generation-assets.js';

describe('GenerationAssets', () => {
  it('releases per-generation projections before shared Plugin scopes', async () => {
    const events: string[] = [];
    const first = GenerationAssets.create(
      () => { events.push('scopes'); },
      [() => { events.push('projection-1'); }],
    );
    const second = first.fork([
      () => { events.push('projection-2'); },
    ]);

    await first.dispose();
    expect(events).toEqual(['projection-1']);

    await second.dispose();
    await second.dispose();
    expect(events).toEqual(['projection-1', 'projection-2', 'scopes']);
  });
});
