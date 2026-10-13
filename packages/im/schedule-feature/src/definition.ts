import type { CapabilityContext } from '@zhin.js/feature-kit';

/** Operation-scoped owner, configuration and resources; never persist this context. */
export type ScheduleContext<TConfig = unknown> = CapabilityContext<TConfig>;

export interface ScheduleDefinition<TConfig = unknown> {
  readonly cron: string;
  readonly description?: string;
  execute(context: ScheduleContext<TConfig>): void | Promise<void>;
}

declare module '@zhin.js/plugin-runtime' {
  interface PluginSetupContext<TConfig = unknown> {
    addSchedule(localName: string, definition: ScheduleDefinition<TConfig>): void;
  }
}

export function defineSchedule<TConfig = unknown>(definition: ScheduleDefinition<TConfig>): Readonly<ScheduleDefinition<TConfig>> {
  return parseScheduleDefinition<TConfig>(definition);
}

export function parseScheduleDefinition<TConfig = unknown>(value: unknown): Readonly<ScheduleDefinition<TConfig>> {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Schedule definition must be an object');
  }
  const definition = value as Partial<ScheduleDefinition<TConfig>>;
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
