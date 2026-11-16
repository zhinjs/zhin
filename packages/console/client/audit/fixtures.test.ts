import { describe, expect, it } from 'vitest';
import { adapterFixture, blueprintFixture, reviewFixture } from './fixtures.js';
import { classifyPage } from './mount-plugin-page.js';

describe('audit fixtures (ADR 0063 P2 layout audit)', () => {
  it('derives a blueprint status from the paths and tables it reads', () => {
    const status = blueprintFixture({
      kind: 'zhin.console.page-blueprint',
      sections: [
        { type: 'stats', items: [{ key: 'n', dataKey: 'feedCount' }, { key: 'h', expr: { $map: { path: 'health.state', cases: {} } } }] },
        { type: 'table', dataKey: 'feeds', columns: [{ key: 'name' }, { key: 'lastAt', type: 'datetime' }, { key: 'status' }] },
        { type: 'entries', entries: [{ label: 'x', expr: { $count: 'targets' } }] },
      ],
    });
    expect(status.feedCount).toBe(3);
    expect((status.health as Record<string, unknown>).state).toBe('示例');
    expect(status.feeds).toHaveLength(3);
    expect((status.feeds as Record<string, unknown>[])[1]).toMatchObject({ status: 'failed', lastAt: expect.any(Number) });
    expect(status.targets).toEqual(['a', 'b', 'c']);
  });

  it('reads blueprints that are functions (definePageBlueprint) and stat value paths', () => {
    const page = Object.assign(() => null, { kind: 'zhin.console.page-blueprint', spec: { stats: [{ key: 'n', label: 'N', value: 'subscriptionCount' }], sections: [{ items: 'subscriptions', columns: [{ key: 'url' }] }] } });
    const status = blueprintFixture(page);
    expect(status.subscriptionCount).toBe(3);
    expect(status.subscriptions).toHaveLength(3);
  });

  it('classifies page modules and ships fixed adapter / review samples', () => {
    expect(classifyPage({ kind: 'zhin.console.adapter-page', adapterKey: 'telegram' })).toBe('adapter');
    expect(classifyPage({ kind: 'zhin.console.page-blueprint', reviewSpec: { adapter: 'bilibili' } })).toBe('review');
    expect(classifyPage(Object.assign(() => null, { kind: 'zhin.console.page-blueprint' }))).toBe('blueprint');
    expect(classifyPage(() => null)).toBe('component');
    expect(classifyPage(undefined)).toBe('unknown');
    expect((adapterFixture('telegram').status.runtime as { endpoints: unknown[] }).endpoints).toHaveLength(1);
    expect((reviewFixture().endpoints as { drafts: unknown[] }[])[0]!.drafts).toHaveLength(1);
  });
});
