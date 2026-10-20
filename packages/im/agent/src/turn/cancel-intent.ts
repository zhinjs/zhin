const CANCEL_KEYWORDS = new Set(['取消', '/cancel', 'cancel']);

export function isCancelIntent(text: string): boolean {
  return CANCEL_KEYWORDS.has(text.trim().toLowerCase());
}
