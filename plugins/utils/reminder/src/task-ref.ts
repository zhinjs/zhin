import type { Locale } from 'zhin.js/i18n';
import { reminderMessages as t } from './i18n.js';
import type { ReminderTask } from './service.js';

/** Shortest ID prefix accepted by `remind cancel` (#1250). */
export const MIN_REMINDER_ID_PREFIX = 6;

export type ReminderRefResolution =
  | { readonly kind: 'found'; readonly task: ReminderTask }
  | { readonly kind: 'error'; readonly message: string };

/** `remind list` numbering: one line block per task, `#1`, `#2`, … in list order. */
export function numberedReminderList(tasks: readonly ReminderTask[], describe: (task: ReminderTask) => string): string {
  return tasks.map((task, index) => `#${index + 1} ${describe(task)}`).join('\n\n');
}

/**
 * Resolves what the user typed after `remind cancel`: a number from `remind list` (`3` / `#3`), the
 * full task ID, or a unique ID prefix of at least {@link MIN_REMINDER_ID_PREFIX} characters.
 * An ambiguous prefix lists the candidates.
 */
export function resolveReminderRef(tasks: readonly ReminderTask[], input: string, locale: Locale): ReminderRefResolution {
  const ref = input.trim();
  const number = /^#?(\d{1,4})$/.exec(ref);
  if (number && (ref.startsWith('#') || ref.length < MIN_REMINDER_ID_PREFIX)) {
    const task = tasks[Number(number[1]) - 1];
    return task ? { kind: 'found', task } : { kind: 'error', message: t(locale, 'refIndexOutOfRange', { index: number[1]!, count: tasks.length }) };
  }
  const exact = tasks.find(task => task.id === ref);
  if (exact) return { kind: 'found', task: exact };
  if (ref.length < MIN_REMINDER_ID_PREFIX) return { kind: 'error', message: t(locale, 'refTooShort', { min: MIN_REMINDER_ID_PREFIX }) };
  const matches = tasks.map((task, index) => ({ task, index })).filter(({ task }) => task.id.startsWith(ref));
  if (matches.length === 1) return { kind: 'found', task: matches[0]!.task };
  if (matches.length === 0) return { kind: 'error', message: t(locale, 'notFound') };
  const candidates = matches.map(({ task, index }) => `#${index + 1} ${task.id} ${task.text.slice(0, 30)}`).join('\n');
  return { kind: 'error', message: t(locale, 'refAmbiguous', { candidates }) };
}

/** The account a reminder belongs to, as the user knows it: the Endpoint instance name, never internal IDs. */
export function reminderAccountName(input: unknown, endpoint: Readonly<{ id: string }>): string {
  const named = input && typeof input === 'object' ? (input as { endpointId?: unknown }).endpointId : undefined;
  if (typeof named === 'string' && named.trim()) return named.trim();
  // Canonical endpoint ids end with `~<instance>`; capability segments are separated by NUL.
  const last = endpoint.id.split('\0').pop() ?? endpoint.id;
  const instance = last.includes('~') ? last.slice(last.lastIndexOf('~') + 1) : last;
  return instance || endpoint.id;
}
