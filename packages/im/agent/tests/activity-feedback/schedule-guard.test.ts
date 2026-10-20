import { describe, it, expect } from 'vitest';
import { isActivityFeedbackEnabled } from '../../src/activity-feedback/schedule-guard.js';
import type { AIEventPayload } from '../../src/ai-event-subscriber.js';

function payload(hook: Record<string, unknown>): AIEventPayload {
  return { sessionId: 's1', source: 'zhin-agent', hookContext: hook };
}

describe('isActivityFeedbackEnabled', () => {
  it('allows queued on manual inbound turn', () => {
    expect(isActivityFeedbackEnabled(payload({ activityFeedbackEligible: true }), 'queued')).toBe(true);
  });

  it('blocks queued on schedule turn without schedule activity', () => {
    expect(isActivityFeedbackEnabled(payload({ scheduleJobId: 'j1' }), 'queued')).toBe(false);
  });

  it('allows schedule_start when schedule activity enabled', () => {
    expect(isActivityFeedbackEnabled(
      payload({ scheduleJobId: 'j1', scheduleActivityFeedback: true }),
      'schedule_start',
    )).toBe(true);
  });
});
