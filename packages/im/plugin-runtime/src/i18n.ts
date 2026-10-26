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
