import { createToken } from './token.js';
import type { DeliveryTarget } from './delivery-target.js';

/** Supported display languages. Time zone and command identities are independent. */
export type Locale = 'zh-CN' | 'en';
export const DEFAULT_LOCALE: Locale = 'zh-CN';
export const SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en'] as const);

export function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en';
}

/** Resolve an absent display preference; configuration writes validate with isLocale. */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Immutable project language, projected with the operation's generation. */
export const projectLocaleToken = createToken<Locale>('zhin.project-locale');

/** Root-owned preferences; identity never comes from display names or profile text. */
export interface UserLocalePreferences {
  get(endpoint: DeliveryTarget['endpoint'], senderId: string): Promise<Locale | undefined>;
  set(endpoint: DeliveryTarget['endpoint'], senderId: string, locale: Locale): Promise<void>;
}
export const userLocalePreferencesToken = createToken<UserLocalePreferences>('zhin.user-locale-preferences');

export type MessageCatalog = Readonly<Record<string, Readonly<Record<Locale, string>>>>;
export type MessageValues = Readonly<Record<string, string | number>>;

/**
 * A package-owned, complete bilingual catalog. No global language or registration.
 * Placeholder substitution is one pass: user text cannot become another template.
 * Values remain plain text; HTML/JSX escaping belongs to the existing renderer.
 */
export function createMessages<const T extends MessageCatalog>(catalog: T) {
  const entries = Object.freeze(Object.fromEntries(Object.entries(catalog).map(([key, value]) => {
    const keys = (text: string) => [...new Set([...text.matchAll(/\{([a-zA-Z][\w]*)\}/gu)].map(match => match[1]!))].sort();
    if (typeof value['zh-CN'] !== 'string' || typeof value.en !== 'string'
      || JSON.stringify(keys(value['zh-CN'])) !== JSON.stringify(keys(value.en))) {
      throw new TypeError(`Invalid bilingual message catalog entry: ${key}`);
    }
    return [key, Object.freeze({ ...value })];
  }))) as T;
  return (locale: Locale | undefined, key: keyof T & string, values: MessageValues = {}): string => {
    const entry = entries[key];
    if (!Object.hasOwn(entries, key) || !entry) throw new TypeError(`Unknown message catalog entry: ${key}`);
    return entry[resolveLocale(locale)].replace(/\{([a-zA-Z][\w]*)\}/gu, (_match, name: string) => {
      if (!Object.hasOwn(values, name)) throw new TypeError(`Missing message value: ${name}`);
      return String(values[name]);
    });
  };
}

export interface FormatDateTimeOptions {
  /** IANA zone; defaults to the process zone (`TZ`, else the system zone). */
  readonly timeZone?: string;
  /** `datetime` (default) `2026-11-15 00:15:56`, `date` `2026-11-15`, `time` `00:15:56`. */
  readonly part?: 'datetime' | 'date' | 'time';
}

const DATE_TIME_FORMATS = new Map<string, Intl.DateTimeFormat>();

/**
 * Date and time for CLI and log output (#1250 `cli-datetime-us-locale`): always
 * `YYYY-MM-DD HH:mm:ss`, 24-hour, in both display languages. `en` deliberately uses the same
 * ISO-8601 style rather than `en-US` / `en-GB`: day-month order is read differently on either side
 * of the Atlantic, ISO order is not, it sorts as text and it matches the `YYYY-MM-DD` days of
 * `zhin usage report`. The locale parameter keeps call sites ready should a language need another
 * form. An invalid date yields `-`.
 */
export function formatDateTime(value: number | Date, locale?: Locale, options: FormatDateTimeOptions = {}): string {
  void resolveLocale(locale);
  const time = value instanceof Date ? value.getTime() : value;
  if (typeof time !== 'number' || !Number.isFinite(time)) return '-';
  // The process zone by name, so a changed `TZ` never reuses a formatter built for the old zone.
  const zone = options.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
  let format = DATE_TIME_FORMATS.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    DATE_TIME_FORMATS.set(zone, format);
  }
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(time)) parts[part.type] = part.value;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const clock = `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:${parts.second}`;
  return options.part === 'date' ? date : options.part === 'time' ? clock : `${date} ${clock}`;
}
