import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { reminderMessages as t } from './i18n.js';
import { createDeliveryTarget } from 'zhin.js';
import type { CommandMessage } from '@zhin.js/command';
import { ReminderInputError, type ReminderActor } from './service.js';

export function reminderActor(input: CommandMessage | undefined, locale: Locale = resolveLocale(input?.locale)): ReminderActor {
  if (!input?.sender?.id) throw new ReminderInputError(t(locale, 'actorRequired'));
  return { senderId: input.sender.id, target: createDeliveryTarget(input), locale };
}

export async function replyReminder(operation: () => Promise<string>): Promise<string> {
  try { return await operation(); }
  catch (error) { if (error instanceof ReminderInputError) return error.message; throw error; }
}
