/**
 * Payload and display redaction shared by the decision audit (`@zhin.js/agent`) and the inbound
 * message outcome ledger (`@zhin.js/core`, ADR 0061 §2). Pure functions with no runtime
 * dependency, moved here from `@zhin.js/agent/src/decision-events.ts` so Core can redact without
 * importing Agent; Agent re-exports them under the same names.
 */

/** A redactable JSON-like payload (plain object). */
export type RedactablePayload = Record<string, unknown>;

const REDACTED = '[redacted]';
const MAX_DEPTH = 5;
const MAX_ENTRIES = 50;
const MAX_STRING_CHARS = 500;

/** 键名（去掉 `-` / `_`、小写后）命中即整值替换。 */
const SECRET_KEYS = new Set([
  'password', 'passwd', 'pwd', 'secret', 'clientsecret', 'token', 'accesstoken', 'refreshtoken',
  'idtoken', 'apikey', 'privatekey', 'authorization', 'auth', 'cookie', 'cookies', 'setcookie',
  'session', 'sessionid', 'sessdata', 'bilijct', 'credential', 'credentials',
]);
/** 规范化后以这些结尾的键名也视为密钥，例如 `openaiApiKey`、`DB_PASSWORD`、`githubToken`。 */
const SECRET_KEY_SUFFIXES = ['token', 'secret', 'password', 'passwd', 'apikey', 'privatekey', 'credential', 'credentials', 'cookie'];

/**
 * 键名是否像密钥：命中审计密钥键表（去掉 `-` / `_`、小写后），或以常见密钥后缀结尾。
 * 供审批详情 / IM 摘录这类展示正文的地方使用；`redactDecisionPayload` 本身仍只按键表精确匹配。
 */
export function isSecretLikeKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SECRET_KEYS.has(normalized) || SECRET_KEY_SUFFIXES.some(suffix => normalized.endsWith(suffix));
}

/** 键名是否是提示词类（完整提示词不得外露，审计里替换为 `[omitted]`）。 */
export function isPromptPayloadKey(key: string): boolean {
  return PROMPT_KEYS.has(normalizeKey(key));
}

/** 提示词类键名：完整提示词不得入审计。 */
const PROMPT_KEYS = new Set([
  'prompt', 'systemprompt', 'system', 'messages', 'instructions', 'rawprompt', 'fullprompt',
]);

/** Name fragments that mark an env variable, flag or header as carrying a secret. */
const SECRET_NAME = '(?:token|secret|password|passwd|pwd|api[-_]?key|private[-_]?key|access[-_]?key|credentials?|cookie|session[-_]?id)';

const SECRET_VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // `Authorization: token abc`, `Proxy-Authorization: Basic …` — the whole credential.
  [/\b((?:proxy-)?authorization)\s*([:=])\s*(?:(?:bearer|basic|token|digest)\s+)?[^\s"',;]{4,}/gi, `$1$2 ${REDACTED}`],
  // `X-Api-Key: …`, `X-Auth-Token: …`
  [new RegExp(`\\b(x-[a-z0-9-]*(?:${SECRET_NAME}|auth)[a-z0-9-]*)\\s*:\\s*[^\\s"',;]+`, 'gi'), `$1: ${REDACTED}`],
  // `FOO_TOKEN=…`, `export API_KEY="…"`, `DB_PASSWORD: …` (env / config assignments).
  // Quoted values keep their quotes: `apiKey = "[redacted]"`.
  [new RegExp(`\\b([A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*\\s*=\\s*)(["'])(?:(?!\\2).)*\\2`, 'gi'), `$1$2${REDACTED}$2`],
  [new RegExp(`\\b([A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*\\s*=\\s*)(?!["'\\[])[^\\s;&|"']+`, 'gi'), `$1${REDACTED}`],
  // `--password=…`, `--token …`, `--api-key …`
  [new RegExp(`(--?[A-Za-z0-9-]*${SECRET_NAME}[A-Za-z0-9-]*(?:=|\\s+))(["'])(?:(?!\\2).)*\\2`, 'gi'), `$1$2${REDACTED}$2`],
  [new RegExp(`(--?[A-Za-z0-9-]*${SECRET_NAME}[A-Za-z0-9-]*(?:=|\\s+))(?!["'\\[])[^\\s"']+`, 'gi'), `$1${REDACTED}`],
  // `https://user:pass@host` — keep the user, hide the password.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s/@]+@/gi, `$1:${REDACTED}@`],
  // JWT (`eyJ…`), AWS access key ids, Google API keys.
  [/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(?:ghp|gho|ghs|ghu|ghr|github_pat|xox[abpr])_[A-Za-z0-9_]{8,}/g, REDACTED],
  [/\b(?:SESSDATA|bili_jct|cookie)\s*[=:]\s*[^;\s]+/gi, REDACTED],
  // JSON fields: `"token":"…"`, `"api_key": "…"` (#1250 batch 26: tool outputs reach logs).
  [new RegExp(`("[A-Za-z0-9_-]*${SECRET_NAME}[A-Za-z0-9_-]*"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi'), `$1"${REDACTED}"`],
  // YAML / prose fields: `api_key: …`, `password: '…'`; a bare number (`max_tokens: 100`) is not a secret.
  [new RegExp(`\\b([A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*\\s*:\\s*)(["'])(?:(?!\\2).)+\\2`, 'gi'), `$1$2${REDACTED}$2`],
  [new RegExp(`\\b([A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*\\s*:\\s*)(?![\\d.]+(?![^\\s,;}\\]]))(?!["'\\[{]|\\[redacted\\])[^\\s,;"'}\\]]+`, 'gi'), `$1${REDACTED}`],
  // URL query keys: `?key=…`, `&key=…`.
  [/([?&]key=)[^&\s#"']+/gi, `$1${REDACTED}`],
  // Telegram Bot API paths: `/bot<id>:<token>/`.
  [/\/bot(\d+):[A-Za-z0-9_-]{20,}/g, `/bot$1:${REDACTED}`],
];

function normalizeKey(key: string): string {
  return key.replaceAll('-', '').replaceAll('_', '').toLowerCase();
}

/** Masks token-shaped text (bearer / API keys / cookies) without truncating; for display surfaces. */
export function redactSecretText(value: string): string {
  let text = value;
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) text = text.replace(pattern, replacement);
  return text;
}

/**
 * ADR 0060 §3.3 (zhinjs/zhin#1250): a chat-owner claim message is the keyword `认领` or `claim` (any
 * letter case) as the first word, whitespace, then exactly one token, and nothing else. Ignored around
 * it: surrounding whitespace, up to three punctuation marks before the keyword (a command prefix such as
 * `#` or `/`, or a quote `「`) and around the token (`<码>`, `」`), copied from a hint.
 */
const CHAT_OWNER_CLAIM_TEXT = /^[^\p{L}\p{N}\s]{0,3}\s*(认领|claim)\s+[^\p{L}\p{N}\s]{0,3}(\S+?)[^\p{L}\p{N}\s]{0,3}$/iu;
/**
 * Whether `text` is a chat-owner claim message, and its keyword (as typed) and code. `prefix` (the
 * adapter's command prefix, which may be a word) may precede the keyword; the bare form matches too.
 * A message where the keyword is not the first word (`我想认领这个任务`, `请认领 X`), is followed by no
 * whitespace (`认领了`) or by more than one token (`claim this task`) is ordinary chat.
 */
export function matchChatOwnerClaimText(text: string, prefix = ''): Readonly<{ keyword: string; code: string }> | undefined {
  const body = text.trim();
  const candidates = prefix && body.startsWith(prefix) ? [body.slice(prefix.length).trim(), body] : [body];
  for (const candidate of candidates) {
    const match = CHAT_OWNER_CLAIM_TEXT.exec(candidate);
    if (match) return Object.freeze({ keyword: match[1]!, code: match[2]! });
  }
  return undefined;
}

/** What may sit between the symbols of a code someone typed: whitespace, `-`, soft hyphens, zero-width characters. */
const CLAIM_CODE_GAP = '[\\s\\-\\u00AD\\u200B-\\u200D\\u2060\\uFEFF]*';

/**
 * Matches `code` the way the claim compares codes (letter case, whitespace and `-` ignored), also when
 * zero-width characters split it; applied to the text as written and to its NFKC form (full-width letters).
 */
function claimCodePattern(code: string, flags: string): RegExp | undefined {
  const symbols = [...code.toUpperCase().replace(/[\s-]/gu, '')];
  if (symbols.length === 0) return undefined;
  return new RegExp(symbols.map(symbol => symbol.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join(CLAIM_CODE_GAP), flags);
}

/** Whether `text` carries `code` anywhere (ADR 0060 §3.3: how inbound recognizes the current claim code). */
export function containsChatOwnerClaimCode(text: string, code: string): boolean {
  const pattern = claimCodePattern(code, 'iu');
  if (!pattern || !text) return false;
  return pattern.test(text) || pattern.test(text.normalize('NFKC'));
}

/** Codes of the claims open in this process (normally at most one). */
const openClaimCodes = new Set<{ readonly code: string }>();

/**
 * Registers an open claim code for {@link redactChatOwnerClaimText}; the returned function unregisters it.
 * The claim registers its current code on every rotation and unregisters it when it closes.
 */
export function registerChatOwnerClaimCode(code: string): () => void {
  const entry = Object.freeze({ code });
  openClaimCodes.add(entry);
  return () => { openClaimCodes.delete(entry); };
}

/**
 * Writer-side backstop (conversation records, Agent session messages, traces): every occurrence of a
 * currently open claim code becomes `***`. Without an open claim nothing is changed — no valid code exists.
 */
export function redactChatOwnerClaimText(text: string): string {
  if (openClaimCodes.size === 0 || !text) return text;
  let result = text;
  for (const { code } of openClaimCodes) {
    const probe = claimCodePattern(code, 'iu');
    if (!probe) continue;
    if (probe.test(result)) result = result.replace(claimCodePattern(code, 'giu')!, '***');
    else if (probe.test(result.normalize('NFKC'))) result = result.normalize('NFKC').replace(claimCodePattern(code, 'giu')!, '***');
  }
  return result;
}

/**
 * Display-only masking for approval prompts (#1250: they may be shown in a chat): secret-named keys and
 * token-shaped text are hidden. Execution, fingerprints and approval scope keys still use the exact arguments.
 */
export function redactApprovalDisplay(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactSecretText(value);
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => redactApprovalDisplay(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    isSecretLikeKey(key) && item !== undefined && item !== null && item !== '' ? REDACTED : redactApprovalDisplay(item, depth + 1),
  ]));
}

function redactString(value: string): string {
  let text = value;
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) text = text.replace(pattern, replacement);
  return text.length > MAX_STRING_CHARS ? `${text.slice(0, MAX_STRING_CHARS)}… [truncated]` : text;
}

function redactValue(value: unknown, depth: number): unknown {
  if (value == null || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (depth >= MAX_DEPTH) return '[max depth]';
  if (Array.isArray(value)) return value.slice(0, MAX_ENTRIES).map((item) => redactValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ENTRIES)) {
      const normalized = normalizeKey(key);
      if (SECRET_KEYS.has(normalized)) out[key] = REDACTED;
      else if (PROMPT_KEYS.has(normalized)) out[key] = '[omitted]';
      else out[key] = redactValue(item, depth + 1);
    }
    return out;
  }
  return null;
}


/** 脱敏并裁剪 payload：密钥类键替换为 `[redacted]`，提示词类键替换为 `[omitted]`，值内令牌打码。 */
export function redactDecisionPayload(payload: RedactablePayload | null | undefined): RedactablePayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return redactValue(payload, 0) as RedactablePayload;
}
