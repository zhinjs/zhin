import { redactSecretText } from '@zhin.js/logger';

const MAX_REASON_CHARS = 300;

/**
 * Lark's `code` and `msg` for a log or error line (#1250 b111): the account's secrets and
 * secret-shaped text are masked first, then the text is bounded (a secret across the cut is not
 * half kept).
 */
export function larkFailureReason(response: Readonly<{ code?: unknown; msg?: unknown }>, secrets: readonly (string | undefined)[]): string {
  let text = typeof response.msg === 'string' ? response.msg : '';
  for (const secret of [...secrets].sort((a, b) => (b?.length ?? 0) - (a?.length ?? 0))) {
    if (secret && secret.length >= 4) text = text.split(secret).join('***');
  }
  text = redactSecretText(text).replace(/\s+/g, ' ').trim() || 'unknown';
  if (text.length > MAX_REASON_CHARS) text = `${text.slice(0, MAX_REASON_CHARS)}…`;
  return `${text} (code ${String(response.code)})`;
}

/**
 * The reason a non-2xx Lark response gives (#1250 b111): its JSON body's `code` / `msg`, masked and
 * bounded, or `undefined` when the body cannot be read or carries neither.
 */
export async function larkHttpFailureReason(
  response: Readonly<{ text?: () => Promise<string> }>,
  secrets: readonly (string | undefined)[],
): Promise<string | undefined> {
  try {
    if (typeof response.text !== 'function') return undefined;
    const body = JSON.parse(await response.text()) as unknown;
    if (!body || typeof body !== 'object') return undefined;
    const { code, msg } = body as { code?: unknown; msg?: unknown };
    if (code === undefined && (typeof msg !== 'string' || !msg.trim())) return undefined;
    return larkFailureReason({ code, msg }, secrets);
  } catch {
    return undefined;
  }
}
