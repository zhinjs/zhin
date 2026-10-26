import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
import { parseAmountToCents } from './money.js';

export const MAX_CATEGORY_LENGTH = 20;
export const MAX_NOTE_LENGTH = 100;

export const ADD_USAGE = t('zh-CN', 'usage');

export interface ParsedEntryInput {
  readonly category: string;
  readonly amountCents: number;
  readonly note: string;
}

export type EntryInputResult =
  | { readonly ok: true; readonly entry: ParsedEntryInput }
  | { readonly ok: false; readonly reason: string };

function rejected(reason: string): EntryInputResult {
  return { ok: false, reason };
}

/** Parses the text after `记`: category, amount, then an optional free-form note. */
export function parseEntryInput(text: string, locale?: Locale): EntryInputResult {
  const usage = t(locale, 'usage');
  const words = text.trim().split(/\s+/u).filter((word) => word !== '');
  if (words.length < 2) return rejected(usage);
  const category = words[0]!;
  const amountText = words[1]!;
  const note = words.slice(2).join(' ');
  const amount = parseAmountToCents(amountText, locale);
  if (!amount.ok) {
    const categoryLooksLikeAmount = parseAmountToCents(category).ok;
    if (categoryLooksLikeAmount) return rejected(t(locale, 'order', { usage }));
    return rejected(t(locale, 'amountError', { reason: amount.reason, usage }));
  }
  if (parseAmountToCents(category).ok) return rejected(t(locale, 'categoryNumber', { usage }));
  if ([...category].length > MAX_CATEGORY_LENGTH) return rejected(t(locale, 'categoryLimit', { max: MAX_CATEGORY_LENGTH }));
  if ([...note].length > MAX_NOTE_LENGTH) return rejected(t(locale, 'noteLimit', { max: MAX_NOTE_LENGTH }));
  return { ok: true, entry: { category, amountCents: amount.cents, note } };
}
