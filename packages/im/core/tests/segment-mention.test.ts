import { describe, it, expect } from 'vitest';
import { readMentionSegmentTarget, readMentionTarget } from '../src/built/segment-contract/mention.js';

describe('readMentionSegmentTarget', () => {
  it('reads canonical target and legacy qq/id fields', () => {
    expect(readMentionTarget({ target: '1689919782' })).toBe('1689919782');
    expect(readMentionSegmentTarget({ type: 'mention', data: { target: '1689919782' } }))
      .toBe('1689919782');
    expect(readMentionSegmentTarget({ type: 'at', data: { qq: '8596238' } }))
      .toBe('8596238');
  });
});
