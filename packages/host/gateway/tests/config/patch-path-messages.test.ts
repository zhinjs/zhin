import { describe, expect, it } from 'vitest';
import { closeConfigKeys, describeArrayPathProblem, unknownConfigKeyMessage } from '../../src/config/patch-path-messages.js';

describe('config patch path messages (#1250)', () => {
  it('suggests close keys for a typo and none for unrelated words', () => {
    expect(closeConfigKeys('htp', ['http', 'database', 'ai', 'sandbox'])).toEqual(['http']);
    expect(closeConfigKeys('sanbox', ['http', 'sandbox'])).toEqual(['sandbox']);
    expect(closeConfigKeys('zzzzzzzz', ['http', 'database'])).toEqual([]);
    expect(unknownConfigKeyMessage('foo', ['http'])).toMatch(/^没有这个配置项：foo/u);
    expect(unknownConfigKeyMessage('foo', ['http'])).not.toContain('gateway.');
  });

  it('explains array indexes outside the array and non-index segments', () => {
    const document = { sandbox: { endpoints: [{ id: 'a' }, { id: 'b' }] }, http: { corsOrigins: [] } };
    expect(describeArrayPathProblem(document, ['sandbox', 'endpoints', '1', 'id'], 'set')).toBeUndefined();
    expect(describeArrayPathProblem(document, ['sandbox', 'endpoints', '2'], 'set'))
      .toBe("sandbox.endpoints.2 超出数组范围（当前有 2 项，下标 0–1）。要追加一项：先用 zhin config get sandbox.endpoints 读出整个数组，加上新项后用 zhin config set sandbox.endpoints '<JSON 数组>' 整体写回");
    expect(describeArrayPathProblem(document, ['sandbox', 'endpoints', '5'], 'remove')).toBe('sandbox.endpoints.5 超出数组范围（当前有 2 项，下标 0–1）');
    expect(describeArrayPathProblem(document, ['http', 'corsOrigins', '0'], 'set')).toContain('当前是空数组');
    expect(describeArrayPathProblem(document, ['sandbox', 'endpoints', 'id'], 'set')).toContain('应为数组下标');
    expect(describeArrayPathProblem(document, ['sandbox', 'missing', '3'], 'set')).toBeUndefined();
  });
});
