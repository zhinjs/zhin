import type { ScheduleJobRegistration } from '@zhin.js/plugin-runtime';

export type ScheduleDefinition = Omit<ScheduleJobRegistration, 'id' | 'owner'>;

declare module '@zhin.js/plugin-runtime' {
  interface PluginSetupContext {
    addSchedule(localName: string, definition: ScheduleDefinition): void;
  }
}

export function defineSchedule(definition: ScheduleDefinition): Readonly<ScheduleDefinition> {
  return parseScheduleDefinition(definition);
}

export function parseScheduleDefinition(value: unknown): Readonly<ScheduleDefinition> {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Schedule definition must be an object');
  }
  const definition = value as Partial<ScheduleDefinition>;
  if (typeof definition.cron !== 'string' || definition.cron.trim() === '') {
    throw new TypeError('Schedule definition requires a non-empty cron string');
  }
  if (typeof definition.execute !== 'function') {
    throw new TypeError('Schedule definition requires execute()');
  }
  if (definition.description !== undefined && typeof definition.description !== 'string') {
    throw new TypeError('Schedule definition description must be a string');
  }
  return Object.freeze({
    cron: definition.cron,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    execute: definition.execute,
  });
}
