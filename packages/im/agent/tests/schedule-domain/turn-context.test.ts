import { describe, expect, it } from 'vitest';
import { scheduleTurnContextView } from '../../src/schedule-domain/turn-context.js';
import { createScheduleSecurityContext } from '../../src/schedule-domain/security-harness.js';

describe('scheduleTurnContextView', () => {
  it('creates a native Schedule origin and demotes the persisted creator', () => {
    const turn = scheduleTurnContextView({
      jobId: 'daily-report',
      createdBy: { userId: 'owner', name: 'Owner', roles: ['master'] },
      security: createScheduleSecurityContext(),
      securityDenials: [],
    });

    expect(turn).toEqual({
      origin: { kind: 'schedule', jobId: 'daily-report' },
      principal: { subjectId: 'owner', displayName: 'Owner', roles: ['trusted'] },
      session: { key: 'schedule:daily-report' },
    });
    expect(turn.origin).not.toHaveProperty('platform');
    expect(turn.origin).not.toHaveProperty('endpoint');
  });

  it('fails closed without a job identity', () => {
    expect(() => scheduleTurnContextView({
      security: createScheduleSecurityContext(),
      securityDenials: [],
    })).toThrow('Schedule Turn requires a jobId');
  });
});
