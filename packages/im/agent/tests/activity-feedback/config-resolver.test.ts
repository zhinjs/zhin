import { describe, it, expect } from 'vitest';
import { resolveActivityFeedbackPhaseConfig } from '../../src/activity-feedback/config-resolver.js';

describe('activity-feedback config-resolver', () => {
  it('uses platform defaults when endpoint config is missing', () => {
    expect(resolveActivityFeedbackPhaseConfig('icqq', undefined, 'queued', 'group')).toEqual({
      type: 'reaction',
      emoji: '⏳',
      autoRemove: true,
    });
    expect(resolveActivityFeedbackPhaseConfig('qq', undefined, 'queued', 'group')).toEqual({
      type: 'none',
    });
  });

  it('merges endpoint phase scene overrides', () => {
    expect(resolveActivityFeedbackPhaseConfig('icqq', {
      phases: {
        queued: { group: { type: 'reaction', emoji: '60' } },
        active: { private: { type: 'message', message: '思考中' } },
      },
    }, 'queued', 'group')).toEqual({
      type: 'reaction',
      emoji: '60',
      autoRemove: true,
    });
  });

  it('respects enabled=false', () => {
    expect(resolveActivityFeedbackPhaseConfig('icqq', { enabled: false }, 'active', 'group')).toEqual({
      type: 'none',
    });
  });
});
