import { isLocale, type Locale } from '@zhin.js/plugin-runtime';

/**
 * Static policy: per-turn locale remains in the dynamic context, keeping cached prefixes stable.
 * #1250 b69: a language the user chose with `/language` outranks the language they write in; only an
 * explicit request in the current message overrides it, and a `[User profile]` language never does.
 */
export const REPLY_LANGUAGE_RULE = "Honor the user's applicable explicit reply-language request first; else the user's /language setting; "
  + 'else match their actual request, not framework notices. If unclear, use Reply language fallback from [Turn context], then SOUL.md.';

/**
 * Trusted turn metadata naming the locale the sender chose with `/language` (#1250 b69). The IM
 * ingress always writes it after untrusted adapter metadata, so an adapter cannot claim it; it counts
 * only while it equals the turn's resolved locale.
 */
export const USER_REPLY_LOCALE_METADATA_KEY = 'zhinUserLocale';

interface ReplyLanguageInput {
  readonly locale?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** The turn locale when the sender set it with `/language`; undefined for a project/default fallback. */
export function userSetReplyLocale(input: ReplyLanguageInput | undefined): Locale | undefined {
  const locale = input?.locale;
  return isLocale(locale) && input?.metadata?.[USER_REPLY_LOCALE_METADATA_KEY] === locale ? locale : undefined;
}

/**
 * Per-turn priority for a `/language` setting, kept in the dynamic turn context so the cached system
 * prefix stays small and identical for every user.
 */
export const USER_SET_REPLY_LANGUAGE_PRIORITY = 'Use it even when they write in another language; only an explicit language request '
  + 'in the current message overrides it, and a language in [User profile] is only a reference.';

/** The per-turn language line: the user's own `/language` setting, or the project fallback. */
export function formatReplyLanguageLine(locale: Locale | undefined, setByUser: boolean): string | undefined {
  if (!isLocale(locale)) return undefined;
  return setByUser
    ? `Reply language (set by the user with /language): ${locale}. ${USER_SET_REPLY_LANGUAGE_PRIORITY}`
    : `Reply language fallback: ${locale}.`;
}
