/**
 * Plugin marketplace metadata for the repository scripts (plugins.json generator, plugin
 * spec check). Mirrors `packages/im/plugin-runtime/src/marketplace-metadata.ts`, the
 * source of truth; `scripts/update-plugins.test.ts` asserts the two lists stay equal.
 */

/** Closed list of `zhin.metadata.category` values. */
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
]);

/** Keywords every Zhin package carries; the market neither shows nor searches them. */
export const GENERIC_PLUGIN_KEYWORDS = Object.freeze([
  'zhin',
  'zhin.js',
  'zhinjs',
  'zhin-plugin',
  'bot',
  'chatbot',
  'plugin',
]);

const GENERIC = new Set(GENERIC_PLUGIN_KEYWORDS);

/** @param {unknown} keywords */
export function informativeKeywords(keywords) {
  if (!Array.isArray(keywords)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of keywords) {
    if (typeof raw !== 'string') continue;
    const keyword = raw.trim();
    const key = keyword.toLowerCase();
    if (!keyword || GENERIC.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

/** @param {unknown} person */
function personName(person) {
  if (typeof person === 'string') {
    const name = person.replace(/<[^>]*>/gu, '').replace(/\([^)]*\)/gu, '').trim();
    return name || undefined;
  }
  if (person && typeof person === 'object' && !Array.isArray(person) && typeof person.name === 'string') {
    return person.name.trim() || undefined;
  }
  return undefined;
}

/**
 * `author`, else `maintainers`. Never `_npmUser` / npm search `publisher`: for CI-published
 * packages that is the release bot ("GitHub Actions").
 * @param {{ author?: unknown, maintainers?: unknown }} pkg
 */
export function packageAuthorName(pkg) {
  const author = personName(pkg?.author);
  if (author) return author;
  if (!Array.isArray(pkg?.maintainers)) return undefined;
  const names = [...new Set(pkg.maintainers.map(personName).filter(Boolean))];
  return names.length ? names.join(', ') : undefined;
}

/** @param {unknown} value */
function localizedText(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  for (const locale of ['zh-CN', 'en']) {
    const text = value[locale];
    if (typeof text === 'string' && text.trim()) result[locale] = text;
  }
  return Object.keys(result).length ? result : undefined;
}

/**
 * Lenient read of `zhin.metadata` marketplace fields from a (published) package document.
 * @param {unknown} zhin
 * @returns {{ displayName?: string, displayNameI18n?: Record<string,string>, descriptionI18n?: Record<string,string>, category?: string }}
 */
export function readMarketplaceMetadata(zhin) {
  const metadata = zhin && typeof zhin === 'object' ? zhin.metadata : undefined;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const displayNameI18n = localizedText(metadata.displayNameI18n);
  const descriptionI18n = localizedText(metadata.descriptionI18n);
  return {
    ...(typeof metadata.displayName === 'string' && metadata.displayName.trim() ? { displayName: metadata.displayName } : {}),
    ...(displayNameI18n ? { displayNameI18n } : {}),
    ...(descriptionI18n ? { descriptionI18n } : {}),
    ...(PLUGIN_CATEGORIES.includes(metadata.category) ? { category: metadata.category } : {}),
  };
}
