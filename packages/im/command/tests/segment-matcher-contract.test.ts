import { describe, expect, it } from 'vitest';
import { SegmentMatcher } from 'segment-matcher';

/** CommandIndex shares one segment array across every route; that requires `match` to leave its input alone. */
describe('segment-matcher input contract', () => {
  it.each([
    ['literal with remainder', 'ping'],
    ['parameter', 'ping <target:text>'],
    ['rest parameter', 'ping [...rest]'],
    ['no match', 'pong'],
  ])('does not mutate the matched segments: %s', (_label, pattern) => {
    const segments = [
      { type: 'text', data: { text: 'ping alice --flag ' } },
      { type: 'mention', data: { target: '42' } },
      { type: 'text', data: { text: ' tail' } },
    ];
    const before = structuredClone(segments);
    const matcher = new SegmentMatcher(pattern);
    const first = matcher.match(segments);
    const second = matcher.match(segments);
    expect(segments).toEqual(before);
    expect(second).toEqual(first);
    for (const remaining of first?.remaining ?? []) expect(segments).not.toContain(remaining);
  });
});
