import type { Locale } from 'zhin.js/i18n';
import { reminderMessages as t } from './i18n.js';
/** Relative durations for Agent tools: `10m`, `2h`, `1d`, or plain seconds. */
import { ReminderInputError } from "./service.js";

export function parseRelativeDelayMs(value: string, locale?: Locale): number {
  const text = value.trim().toLowerCase();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    if (!Number.isSafeInteger(seconds) || seconds < 1) {
      throw new ReminderInputError(t(locale, 'durationInvalid'));
    }
    return seconds * 1000;
  }
  const match = /^(\d+)\s*(s|m|h|d|秒|分|分钟|小时|天)$/u.exec(text);
  if (!match) {
    throw new ReminderInputError(t(locale, 'durationFormat'));
  }
  const amount = Number(match[1]);
  const unit = match[2]!;
  const factor = {
    s: 1000,
    秒: 1000,
    m: 60_000,
    分: 60_000,
    分钟: 60_000,
    h: 3_600_000,
    小时: 3_600_000,
    d: 86_400_000,
    天: 86_400_000,
  }[unit]!;
  return amount * factor;
}
