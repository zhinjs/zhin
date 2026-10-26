import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
/**
 * Amounts are stored as integer cents (分) and parsed from text without floating point,
 * so 0.1 + 0.2 style rounding errors cannot enter the ledger.
 */

/** Largest single entry: ¥1,000,000.00, which also keeps sums far below Number.MAX_SAFE_INTEGER. */
export const MAX_ENTRY_CENTS = 100_000_000;

export type AmountParseResult =
  | { readonly ok: true; readonly cents: number }
  | { readonly ok: false; readonly reason: string };

const AMOUNT_PATTERN = /^(\d{1,7})(?:\.(\d{1,2}))?$/u;
const CURRENCY_PREFIX = /^[¥￥]/u;
const CURRENCY_SUFFIX = /(?:元|块|rmb|RMB|CNY)$/u;

/** Turns full-width digits and the full-width dot into ASCII so `１２．５` parses like `12.5`. */
function toHalfWidth(text: string): string {
  return text.replace(/[０-９．]/gu, (character) => {
    if (character === '．') return '.';
    const fullWidthZero = '０'.codePointAt(0)!;
    return String(character.codePointAt(0)! - fullWidthZero);
  });
}

function invalid(reason: string): AmountParseResult {
  return { ok: false, reason };
}

/** Parses `18`, `18.5`, `18.50`, `¥18.5` or `18.5元` into cents; rejects negatives, zero, exponents and more than two decimals. */
export function parseAmountToCents(raw: string, locale?: Locale): AmountParseResult {
  const normalized = toHalfWidth(raw.trim());
  const withoutCurrency = normalized.replace(CURRENCY_PREFIX, '').replace(CURRENCY_SUFFIX, '').trim();
  if (withoutCurrency.startsWith('-')) return invalid(t(locale, 'negative'));
  const match = AMOUNT_PATTERN.exec(withoutCurrency);
  if (!match) return invalid(t(locale, 'amountFormat'));
  const wholeYuan = Number(match[1]);
  const fractionDigits = (match[2] ?? '').padEnd(2, '0');
  const cents = wholeYuan * 100 + Number(fractionDigits);
  if (cents === 0) return invalid(t(locale, 'zero'));
  if (cents > MAX_ENTRY_CENTS) return invalid(t(locale, 'amountMax'));
  return { ok: true, cents };
}

/** Formats cents as `¥12.50`. */
export function formatCents(cents: number): string {
  const wholeYuan = Math.floor(cents / 100);
  const remainingCents = cents % 100;
  return `¥${wholeYuan}.${String(remainingCents).padStart(2, '0')}`;
}

/** The text shown instead of an amount where other people can read the reply. */
export const MASKED_AMOUNT = '¥***';
