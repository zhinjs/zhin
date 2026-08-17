import type { ScheduleJobCreator } from '../assistant/types.js';

export interface ScheduleSecurityContext {
  readonly execPreset: 'readonly' | 'network';
  readonly rejectOwnerApproval: true;
  readonly allowedDomains: readonly string[];
}

export interface ScheduleSecurityDenial {
  readonly tool: string;
  readonly policy: string;
  readonly reason: string;
}

export function createScheduleSecurityContext(
  execPreset: ScheduleSecurityContext['execPreset'] = 'readonly',
  allowedDomains: string[] = [],
): ScheduleSecurityContext {
  return Object.freeze({
    execPreset,
    rejectOwnerApproval: true,
    allowedDomains: Object.freeze([...allowedDomains]),
  });
}

export function demoteScheduleCreator(creator: ScheduleJobCreator): ScheduleJobCreator {
  const roles = creator.roles.includes('master')
    ? ['trusted'] as const
    : creator.roles.includes('trusted')
      ? ['user'] as const
      : [];
  return { ...creator, roles };
}
