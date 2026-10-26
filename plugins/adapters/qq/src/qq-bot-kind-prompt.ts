import { conversationRefKey } from '@zhin.js/im-contract';
import { createDeliveryTarget } from 'zhin.js';
import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
import { parseQqBotKind, type QqBotKind } from './qq-intents.js';

/** Bind replies to the complete canonical conversation and actual sender. */
export function qqCommandSessionKey(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const message = input as { conversation?: unknown; sender?: { id?: unknown } };
  if (typeof message.sender?.id !== 'string' || !message.sender.id.trim()) return undefined;
  try {
    const conversation = createDeliveryTarget({ conversation: message.conversation as Parameters<typeof createDeliveryTarget>[0]['conversation'] });
    return JSON.stringify([conversationRefKey(conversation), message.sender.id]);
  } catch { return undefined; }
}

/** Public/private are stable botKind values; Chinese aliases apply only to Chinese flows. */
export function parseQqBotKindAnswer(raw: unknown, locale?: Locale): QqBotKind | undefined {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return undefined;
  if (resolveLocale(locale) === 'zh-CN') {
    if (text === '公域' || text === '公开' || text === '1') return 'public';
    if (text === '私域' || text === '2') return 'private';
  }
  return parseQqBotKind(text);
}

export function qqBotKindPrompt(locale?: Locale, cancelCommand?: string): string {
  return t(locale, 'kindPrompt') + (cancelCommand ? '\n' + t(locale, 'cancelHint', { command: cancelCommand }) : '');
}
export const QQ_BOT_KIND_PROMPT = qqBotKindPrompt();
