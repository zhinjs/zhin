/**
 * Plugin marketplace metadata: the `package.json#zhin.metadata` fields the plugin market
 * (plugins.json, Console marketplace, `zhin search` / `zhin info`) shows, and the readers
 * that project them from published npm documents.
 *
 * The market only sees what npm publishes, so marketplace fields live in the package
 * manifest, never in `definePlugin()` code. Readers here are lenient (a malformed published
 * field is skipped, not fatal); the strict check runs when the manifest is loaded.
 */
import type { Locale } from './i18n.js';

/** Translations keyed by Console / CLI locale (`zh-CN` / `en`). */
export type PluginLocalizedText = Readonly<Partial<Record<Locale, string>>>;

/**
 * Marketplace categories. A closed list so the market can filter and label them; one per
 * package (`zhin.metadata.category`).
 */
export const PLUGIN_CATEGORIES = Object.freeze([
  'adapter',
  'ai',
  'admin',
  'community',
  'entertainment',
  'game',
  'information',
  'moderation',
  'service',
  'utility',
] as const);

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

/** Display labels of {@link PLUGIN_CATEGORIES}. */
export const PLUGIN_CATEGORY_LABELS: Readonly<Record<PluginCategory, Readonly<Record<Locale, string>>>> = Object.freeze({
  adapter: Object.freeze({ 'zh-CN': '平台适配器', en: 'Adapters' }),
  ai: Object.freeze({ 'zh-CN': 'AI 能力', en: 'AI' }),
  admin: Object.freeze({ 'zh-CN': '运维管理', en: 'Administration' }),
  community: Object.freeze({ 'zh-CN': '群组运营', en: 'Community' }),
  entertainment: Object.freeze({ 'zh-CN': '娱乐互动', en: 'Entertainment' }),
  game: Object.freeze({ 'zh-CN': '游戏', en: 'Games' }),
  information: Object.freeze({ 'zh-CN': '资讯订阅', en: 'Information & feeds' }),
  moderation: Object.freeze({ 'zh-CN': '内容安全', en: 'Moderation' }),
  service: Object.freeze({ 'zh-CN': '基础服务', en: 'Services' }),
  utility: Object.freeze({ 'zh-CN': '实用工具', en: 'Utilities' }),
});

export function isPluginCategory(value: unknown): value is PluginCategory {
  return typeof value === 'string' && (PLUGIN_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Categories written by older plugin registries (`plugins.json` grouped by workspace
 * directory). Read-side compatibility only; manifests must use {@link PLUGIN_CATEGORIES}.
 */
const LEGACY_CATEGORY_ALIASES: Readonly<Record<string, PluginCategory>> = Object.freeze({
  util: 'utility',
  utils: 'utility',
  feature: 'utility',
  adapters: 'adapter',
  games: 'game',
  services: 'service',
});

/** A known category, a legacy registry alias mapped to one, or undefined. */
export function normalizePluginCategory(value: unknown): PluginCategory | undefined {
  if (isPluginCategory(value)) return value;
  return typeof value === 'string' ? LEGACY_CATEGORY_ALIASES[value] : undefined;
}

/**
 * Keywords that every Zhin package carries and that say nothing about what it does. They stay
 * allowed in `package.json#keywords` (npm keyword search links use `zhin.js`), but the market
 * neither shows them nor matches searches against them.
 */
export const GENERIC_PLUGIN_KEYWORDS = Object.freeze([
  'zhin',
  'zhin.js',
  'zhinjs',
  'zhin-plugin',
  'bot',
  'chatbot',
  'plugin',
] as const);

const GENERIC_KEYWORDS = new Set<string>(GENERIC_PLUGIN_KEYWORDS);

/** Keywords worth showing: generic ones removed, trimmed, case-insensitively de-duplicated. */
export function informativeKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of keywords) {
    if (typeof raw !== 'string') continue;
    const keyword = raw.trim();
    const key = keyword.toLowerCase();
    if (!keyword || GENERIC_KEYWORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

function personName(person: unknown): string | undefined {
  if (typeof person === 'string') {
    // npm "Name <email> (url)" shorthand: the name is everything before the first `<` or `(`.
    // Taking that prefix (rather than deleting bracketed parts) leaves no partially removed markup.
    const cut = person.search(/[<(]/u);
    const name = (cut === -1 ? person : person.slice(0, cut)).trim();
    return name || undefined;
  }
  if (person && typeof person === 'object' && !Array.isArray(person)) {
    const name = (person as { name?: unknown }).name;
    return typeof name === 'string' && name.trim() ? name.trim() : undefined;
  }
  return undefined;
}

/**
 * Author shown by the market: `author`, else the package's `maintainers`. Never the publishing
 * account (`_npmUser` / npm search `publisher`), which is the release bot for CI-published
 * packages.
 */
export function packageAuthorName(pkg: { readonly author?: unknown; readonly maintainers?: unknown }): string | undefined {
  const author = personName(pkg.author);
  if (author) return author;
  if (!Array.isArray(pkg.maintainers)) return undefined;
  const names = [...new Set(pkg.maintainers.map(personName).filter((name): name is string => !!name))];
  return names.length ? names.join(', ') : undefined;
}

/** Marketplace fields read from a published package's `zhin` field. */
export interface PluginMarketplaceMetadata {
  readonly displayName?: string;
  readonly displayNameI18n?: PluginLocalizedText;
  readonly descriptionI18n?: PluginLocalizedText;
  readonly category?: PluginCategory;
}

function readLocalizedText(value: unknown): PluginLocalizedText | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Partial<Record<Locale, string>> = {};
  for (const locale of ['zh-CN', 'en'] as const) {
    const text = (value as Record<string, unknown>)[locale];
    if (typeof text === 'string' && text.trim()) result[locale] = text;
  }
  return Object.keys(result).length ? Object.freeze(result) : undefined;
}

/** Lenient projection of `zhin.metadata` from a published (untrusted) package document. */
export function readPluginMarketplaceMetadata(zhin: unknown): PluginMarketplaceMetadata {
  if (!zhin || typeof zhin !== 'object' || Array.isArray(zhin)) return {};
  const metadata = (zhin as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const record = metadata as Record<string, unknown>;
  const displayNameI18n = readLocalizedText(record.displayNameI18n);
  const descriptionI18n = readLocalizedText(record.descriptionI18n);
  const category = isPluginCategory(record.category) ? record.category : undefined;
  return Object.freeze({
    ...(typeof record.displayName === 'string' && record.displayName.trim() ? { displayName: record.displayName } : {}),
    ...(displayNameI18n ? { displayNameI18n } : {}),
    ...(descriptionI18n ? { descriptionI18n } : {}),
    ...(category ? { category } : {}),
  });
}

/** `texts[locale]`, else English, else the other translation, else `fallback`. */
export function pickLocalizedText(
  texts: PluginLocalizedText | undefined,
  locale: Locale,
  fallback?: string,
): string | undefined {
  return texts?.[locale] ?? texts?.en ?? texts?.['zh-CN'] ?? fallback;
}
