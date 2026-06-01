import type { ToolContext } from '@zhin.js/core';
import { UserProfileStore } from '../user-profile.js';
import {
  WEB_SEARCH_LOCALE_EXTRA_KEY,
  normalizeWebSearchLocaleHint,
} from '../builtin/web-search-locale.js';

export async function attachWebSearchLocale(
  context: ToolContext,
  userId: string,
  userProfiles: UserProfileStore,
): Promise<ToolContext> {
  const extra: Record<string, unknown> = { ...(context.extra ?? {}) };
  const existing = extra[WEB_SEARCH_LOCALE_EXTRA_KEY];
  if (typeof existing === 'string' && existing.trim()) {
    extra[WEB_SEARCH_LOCALE_EXTRA_KEY] = normalizeWebSearchLocaleHint(existing);
    return { ...context, extra };
  }
  const [preferred, language] = await Promise.all([
    userProfiles.get(userId, 'preferred_language'),
    userProfiles.get(userId, 'language'),
  ]);
  const hint = (preferred ?? language)?.trim();
  if (hint) {
    extra[WEB_SEARCH_LOCALE_EXTRA_KEY] = normalizeWebSearchLocaleHint(hint);
  }
  return { ...context, extra };
}