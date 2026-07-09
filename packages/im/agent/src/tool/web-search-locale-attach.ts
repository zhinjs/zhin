import type { AgentTurnMessage, Message } from '@zhin.js/core';
import { UserProfileStore } from '../user-profile.js';
import {
  WEB_SEARCH_LOCALE_EXTRA_KEY,
  normalizeWebSearchLocaleHint,
} from '../builtin/web-search-locale.js';

export async function attachWebSearchLocale(
  commMessage: Message,
  userId: string,
  userProfiles: UserProfileStore,
): Promise<Message> {
  const turn = commMessage as AgentTurnMessage;
  const extra: Record<string, unknown> = { ...(turn.extra ?? {}) };
  const existing = extra[WEB_SEARCH_LOCALE_EXTRA_KEY];
  if (typeof existing === 'string' && existing.trim()) {
    extra[WEB_SEARCH_LOCALE_EXTRA_KEY] = normalizeWebSearchLocaleHint(existing);
    return { ...commMessage, extra } as Message;
  }
  const [preferred, language] = await Promise.all([
    userProfiles.get(userId, 'preferred_language'),
    userProfiles.get(userId, 'language'),
  ]);
  const hint = (preferred ?? language)?.trim();
  if (hint) {
    extra[WEB_SEARCH_LOCALE_EXTRA_KEY] = normalizeWebSearchLocaleHint(hint);
  }
  return { ...commMessage, extra } as Message;
}
