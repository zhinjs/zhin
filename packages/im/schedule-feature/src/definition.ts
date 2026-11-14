import type { CapabilityContext } from '@zhin.js/feature-kit';
import type { ScheduleJobKind } from '@zhin.js/plugin-runtime';

/** Operation-scoped owner, configuration and resources; never persist this context. */
export type ScheduleContext<TConfig = unknown> = CapabilityContext<TConfig>;

export interface ScheduleDefinition<TConfig = unknown> {
  readonly cron: string;
  readonly description?: string;
  /** Title shown in Console「定时任务」; prefer the project default language (Chinese for official plugins). */
  readonly title?: string;
  /** Per-locale titles, e.g. `{ en: 'Flush message statistics' }`. */
  readonly titleI18n?: Readonly<Partial<Record<string, string>>>;
  /** Defaults to `plugin-internal` (background polling / housekeeping). */
  readonly kind?: ScheduleJobKind;
  execute(context: ScheduleContext<TConfig>): void | Promise<void>;
}

declare module '@zhin.js/plugin-runtime' {
  interface PluginSetupContext<TConfig = unknown> {
    addSchedule(localName: string, definition: ScheduleDefinition<TConfig>): void;
  }
}

export type ScheduleDefiner<TConfig> = (
  definition: ScheduleDefinition<TConfig>,
) => Readonly<ScheduleDefinition<TConfig>>;

export function defineSchedule<TConfig = unknown>(definition: ScheduleDefinition<TConfig>): Readonly<ScheduleDefinition<TConfig>> {
  return parseScheduleDefinition<TConfig>(definition);
}

/**
 * Fix the plugin config type first, then define the schedule.
 */
defineSchedule.withConfig = function withConfig<TConfig = unknown>(): ScheduleDefiner<TConfig> {
  return (definition) => defineSchedule(definition);
};

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
  if (definition.title !== undefined && typeof definition.title !== 'string') {
    throw new TypeError('Schedule definition title must be a string');
  }
  if (definition.kind !== undefined && definition.kind !== 'plugin-internal' && definition.kind !== 'user-task') {
    throw new TypeError("Schedule definition kind must be 'plugin-internal' or 'user-task'");
  }
  const titleI18n = definition.titleI18n;
  if (titleI18n !== undefined && (!titleI18n || typeof titleI18n !== 'object' || Array.isArray(titleI18n)
    || Object.values(titleI18n).some(value => value !== undefined && typeof value !== 'string'))) {
    throw new TypeError('Schedule definition titleI18n must map locales to strings');
  }
  return Object.freeze({
    cron: definition.cron,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    ...(definition.title === undefined ? {} : { title: definition.title }),
    ...(titleI18n === undefined ? {} : { titleI18n: Object.freeze({ ...titleI18n }) }),
    ...(definition.kind === undefined ? {} : { kind: definition.kind }),
    execute: definition.execute,
  });
}
