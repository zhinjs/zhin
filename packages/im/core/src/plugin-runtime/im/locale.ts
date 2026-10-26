import { projectLocaleToken, resolveLocale, userLocalePreferencesToken,
  type Locale, type RuntimeSnapshot, type UserLocalePreferences } from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';

export function projectLocale(snapshot: RuntimeSnapshot): Locale {
  return resolveLocale(snapshot.resources.get(snapshot.root)?.get(projectLocaleToken.id)
    ?? (snapshot.config.get(snapshot.root) as { locale?: unknown } | undefined)?.locale);
}

/** Resolve once per operation; callbacks retain the original operation's language. */
export async function messageLocale(snapshot: RuntimeSnapshot, conversation: ConversationRef,
  senderId?: string): Promise<Locale> {
  const preferences = snapshot.resources.get(snapshot.root)?.get(userLocalePreferencesToken.id) as UserLocalePreferences | undefined;
  return senderId && preferences
    ? await preferences.get(conversation.endpoint, senderId) ?? projectLocale(snapshot)
    : projectLocale(snapshot);
}
