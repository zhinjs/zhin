import { AUTHORING_KIND, type AuthoringScheduleDefinition } from './types.js';

export type DefineScheduleInput = Omit<AuthoringScheduleDefinition, typeof AUTHORING_KIND>;

export function defineSchedule(input: DefineScheduleInput): AuthoringScheduleDefinition {
  return {
    [AUTHORING_KIND]: 'schedule',
    ...input,
  };
}
