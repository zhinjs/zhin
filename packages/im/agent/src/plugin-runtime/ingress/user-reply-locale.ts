import type { Message } from '@zhin.js/core';
import {
  isLocale,
  userLocalePreferencesToken,
  type Locale,
  type RuntimeSnapshot,
  type UserLocalePreferences,
} from '@zhin.js/plugin-runtime';

/**
 * #1250 b69: the message locale when it is the sender's own `/language` setting (as opposed to the
 * project locale or the zh-CN default). Reads the same root preference port the IM ingress resolved
 * `message.locale` from; a failed or changed read falls back to "not set by the user".
 */
export async function readUserSetReplyLocale(snapshot: RuntimeSnapshot, message: Message): Promise<Locale | undefined> {
  const senderId = message.sender?.id;
  if (!senderId || !isLocale(message.locale)) return undefined;
  const preferences = snapshot.resources.get(snapshot.root)?.get(userLocalePreferencesToken.id) as UserLocalePreferences | undefined;
  if (!preferences) return undefined;
  try {
    const preferred = await preferences.get(message.conversation.endpoint, senderId);
    return preferred === message.locale ? preferred : undefined;
  } catch {
    return undefined;
  }
}
