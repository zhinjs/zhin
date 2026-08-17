import { describe, expect, it } from 'vitest';
import {
  createScheduleSecurityContext,
  demoteScheduleCreator,
} from '../../src/schedule-domain/security-harness.js';

describe('schedule security harness', () => {
  it('demotes creator roles by one level', () => {
    expect(demoteScheduleCreator({ userId: 'u1', roles: ['master'] }).roles).toEqual(['trusted']);
    expect(demoteScheduleCreator({ userId: 'u2', roles: ['trusted'] }).roles).toEqual(['user']);
    expect(demoteScheduleCreator({ userId: 'u3', roles: ['user'] }).roles).toEqual([]);
  });

  it('creates immutable unattended security authority', () => {
    expect(createScheduleSecurityContext('network', ['api.example.com'])).toEqual({
      execPreset: 'network',
      rejectOwnerApproval: true,
      allowedDomains: ['api.example.com'],
    });
  });
});
