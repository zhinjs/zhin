import { adminText, type AdminTextKey } from './admin-i18n.js';

export class LocalizedQuietHoursError extends TypeError {
  readonly messageKey: AdminTextKey;
  constructor(messageKey: AdminTextKey) { super(adminText('zh-CN', messageKey)); this.messageKey = messageKey; }
}

export type RssQuietHours = {
  readonly timezone: string;
  readonly start: string;
  readonly end: string;
};

/** Flat provider parameters keep the generic task form editable, including clearing all three inputs. */
export function parseQuietHours(parameters: Readonly<Record<string, unknown>>): RssQuietHours | undefined {
  const values = [parameters.quietTimezone, parameters.quietStart, parameters.quietEnd];
  if (values.every(value => value === undefined || (typeof value === 'string' && !value.trim()))) return undefined;
  if (!values.every(value => typeof value === 'string' && value.trim())) throw new LocalizedQuietHoursError('quietFields');
  const [timezone, start, end] = values.map(value => (value as string).trim());
  if (timezone.length > 128 || !/^[A-Za-z][A-Za-z0-9_+/-]*$/u.test(timezone)) throw new LocalizedQuietHoursError('quietZoneOffset');
  try { new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(0); }
  catch { throw new LocalizedQuietHoursError('quietZone'); }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(end) || start === end) {
    throw new LocalizedQuietHoursError('quietClock');
  }
  return Object.freeze({ timezone, start, end });
}

/** Test the actual local minute. No inferred next wall-clock Date or DST disambiguation. */
export function isRssQuietMinute(policy: RssQuietHours, at: number): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: policy.timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
  const minute = Number(parts.find(part => part.type === 'hour')!.value) * 60 + Number(parts.find(part => part.type === 'minute')!.value);
  const start = minutes(policy.start), end = minutes(policy.end);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function minutes(value: string): number { return Number(value.slice(0, 2)) * 60 + Number(value.slice(3)); }
