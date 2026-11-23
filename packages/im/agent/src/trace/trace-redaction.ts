import { redactChatIdentityBindText, redactChatOwnerClaimText } from '@zhin.js/kernel';

const INLINE_SECRET_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, '[redacted]'],
  [/\b(?:ghp|gho|ghs|github_pat|xox[abpr])[_-][A-Za-z0-9_-]{12,}/g, '[redacted]'],
  [/("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)"?\s*[:=]\s*"?)[^"\s,}]+/gi, '$1[redacted]'],
];

/**
 * Masks credentials that appear inline in free text (error messages, string args), and an open
 * chat-owner claim code (ADR 0060 §3.3 backstop: messages carrying it never reach a turn); a text that
 * is a chat-identity bind message (`绑定 <码>`) becomes `绑定 ***` (#1250, by its shape alone).
 */
export function scrubSecrets(text: string): string {
  return redactChatIdentityBindText(redactChatOwnerClaimText(INLINE_SECRET_RULES.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text)));
}
