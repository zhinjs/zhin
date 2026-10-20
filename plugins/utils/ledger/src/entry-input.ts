import { parseAmountToCents } from './money.js';

export const MAX_CATEGORY_LENGTH = 20;
export const MAX_NOTE_LENGTH = 100;

export const ADD_USAGE = '格式：记 <类别> <金额> [备注]，例如：记 午饭 18.5 和同事';

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
export function parseEntryInput(text: string): EntryInputResult {
  const words = text.trim().split(/\s+/u).filter((word) => word !== '');
  if (words.length < 2) return rejected(ADD_USAGE);
  const category = words[0]!;
  const amountText = words[1]!;
  const note = words.slice(2).join(' ');
  const amount = parseAmountToCents(amountText);
  if (!amount.ok) {
    const categoryLooksLikeAmount = parseAmountToCents(category).ok;
    if (categoryLooksLikeAmount) return rejected(`类别要写在金额前面。${ADD_USAGE}`);
    return rejected(`${amount.reason}。${ADD_USAGE}`);
  }
  if (parseAmountToCents(category).ok) return rejected(`类别不能是数字。${ADD_USAGE}`);
  if ([...category].length > MAX_CATEGORY_LENGTH) return rejected(`类别最多 ${MAX_CATEGORY_LENGTH} 个字`);
  if ([...note].length > MAX_NOTE_LENGTH) return rejected(`备注最多 ${MAX_NOTE_LENGTH} 个字`);
  return { ok: true, entry: { category, amountCents: amount.cents, note } };
}
