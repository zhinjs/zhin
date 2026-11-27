/**
 * Payload and display redaction shared by the decision audit (`@zhin.js/agent`) and the inbound
 * message outcome ledger (`@zhin.js/core`, ADR 0061 §2). Pure functions with no runtime
 * dependency, moved here from `@zhin.js/agent/src/decision-events.ts` so Core can redact without
 * importing Agent; Agent re-exports them under the same names.
 */
import { redactSecretText } from '@zhin.js/logger';

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

function normalizeKey(key: string): string {
  return key.replaceAll('-', '').replaceAll('_', '').toLowerCase();
}

/**
 * Masks token-shaped text (bearer / API keys / cookies / PEM blocks) without truncating; for display
 * surfaces. The text rules live in `@zhin.js/logger` (#1250 b111) so provider-layer packages that may
 * not import the kernel (`@zhin.js/adapter`) redact with the same rules; re-exported here unchanged.
 */
export { redactSecretText };

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

/**
 * What may sit between the symbols of a code someone typed, and is ignored when codes are compared:
 * whitespace, `-`, format characters (`\p{Cf}`: soft hyphen, zero-width characters, U+2061–2064,
 * U+200E/200F, U+180E, U+FEFF, …) and combining marks (`\p{M}`: U+034F, U+FE0F, …), all invisible
 * or nearly so. `normalizeCode` in `zhin.js/instance` (chat-owner-claim) ignores exactly these too.
 */
const CLAIM_CODE_GAP = /[\s\-\p{Cf}\p{M}]/u;
const CLAIM_CODE_GAPS = /[\s\-\p{Cf}\p{M}]+/gu;
const NON_ASCII = /[\u0080-\u{10FFFF}]/u;

/** Text folded for code comparison (`nfkc`: after NFKC): upper case first (it may add a mark: `ǰ` → `J` + U+030C), then gaps dropped. */
function foldClaimText(text: string, nfkc: boolean): string {
  return (nfkc ? text.normalize('NFKC') : text).toUpperCase().replace(CLAIM_CODE_GAPS, '');
}

/**
 * `text` the way claim codes are compared (ADR 0060 §3.3): NFKC, upper case, gap characters dropped.
 * The claim's exact comparison (`normalizeCode`) starts from this, so text that grants always carries
 * the code for {@link containsChatOwnerClaimCode}.
 */
export function foldChatOwnerClaimText(text: string): string {
  return foldClaimText(text, true);
}

/** `code` as compared: NFKC, upper case, gaps dropped (`undefined`: nothing to compare). */
function foldClaimCode(code: string): string | undefined {
  return foldClaimText(code, true) || undefined;
}

/**
 * Whether folded `text` contains `target`: as written (a combining mark after a code symbol is a gap)
 * and in its NFKC form (full-width letters). ASCII text is its own NFKC form: it is folded once.
 */
function containsFolded(text: string, target: string): boolean {
  if (foldClaimText(text, false).includes(target)) return true;
  return NON_ASCII.test(text) && foldClaimText(text, true).includes(target);
}

/** Whether `text` carries `code` anywhere (ADR 0060 §3.3: how inbound recognizes the current claim code). */
export function containsChatOwnerClaimCode(text: string, code: string): boolean {
  const target = foldClaimCode(code);
  if (!target || !text) return false;
  return containsFolded(text, target);
}

/**
 * A streaming {@link containsChatOwnerClaimCode} over many strings (the strings of a native event): the
 * folded strings are concatenated directly, with no separator between them, so a code split across two
 * neighbouring strings is found too. Each string is folded
 * once as written and, only when it is not ASCII, once more after NFKC; nothing but the last
 * `code.length - 1` folded symbols is kept between strings.
 */
export interface ChatOwnerClaimCodeScanner {
  /** Feeds the next string; `true` once the code has been seen (in it, or across it and the previous ones). */
  feed(text: string): boolean;
}

export function createChatOwnerClaimCodeScanner(code: string): ChatOwnerClaimCodeScanner {
  const target = foldClaimCode(code);
  const keep = target ? target.length - 1 : 0;
  let written = '';
  let normalized = '';
  let found = false;
  return Object.freeze({
    feed(text: string): boolean {
      if (found || !target || !text) return found;
      const raw = foldClaimText(text, false);
      const nfkc = NON_ASCII.test(text) ? foldClaimText(text, true) : raw;
      written += raw;
      normalized += nfkc;
      if (written.includes(target) || normalized.includes(target)) return (found = true);
      written = keep ? written.slice(-keep) : '';
      normalized = keep ? normalized.slice(-keep) : '';
      return false;
    },
  });
}

/**
 * Source ranges `[start, end)` of every occurrence of `target` in `text`, folding each code point on
 * its own (gaps dropped, NFKC, upper case) so that a hit maps back to the characters as written.
 */
function claimCodeRanges(text: string, target: string): [number, number][] {
  let folded = '';
  /** Per code unit of `folded`: the source range of the character it came from. */
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const char of text) {
    const end = index + char.length;
    if (!CLAIM_CODE_GAP.test(char)) {
      const mapped = NON_ASCII.test(char) ? foldClaimText(char, true) : char.toUpperCase();
      folded += mapped;
      for (let unit = 0; unit < mapped.length; unit += 1) { starts.push(index); ends.push(end); }
    }
    index = end;
  }
  const ranges: [number, number][] = [];
  for (let at = folded.indexOf(target); at !== -1; at = folded.indexOf(target, at + target.length)) {
    const start = starts[at]!;
    const end = ends[at + target.length - 1]!;
    const previous = ranges.at(-1);
    if (previous && start < previous[1]) previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
  }
  return ranges;
}

/**
 * Codes of the claims open in this process (normally at most one). One set per process, even when this
 * module is loaded more than once (two copies of `@zhin.js/kernel` in a project, or source and build in
 * one run): the claim may register through one copy while a writer redacts through another.
 */
const OPEN_CLAIM_CODES = Symbol.for('zhin.kernel.chat-owner-claim-codes');
const openClaimCodes: Set<{ readonly code: string }> = (() => {
  const host = globalThis as { [OPEN_CLAIM_CODES]?: Set<{ readonly code: string }> };
  return host[OPEN_CLAIM_CODES] ??= new Set<{ readonly code: string }>();
})();

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
 * currently open claim code becomes `***`. Only the characters of a hit are replaced, everything else is
 * kept as written — also when only the NFKC form shows the code (`ＱＷＥＲＴＹ２３`). Without an open
 * claim nothing is changed — no valid code exists.
 */
export function redactChatOwnerClaimText(text: string): string {
  if (openClaimCodes.size === 0 || !text) return text;
  let result = text;
  for (const { code } of openClaimCodes) {
    const target = foldClaimCode(code);
    if (!target || !containsFolded(result, target)) continue;
    const ranges = claimCodeRanges(result, target);
    // Fail closed: the code is there but cannot be located character by character.
    if (ranges.length === 0) return '***';
    let next = '';
    let cursor = 0;
    for (const [start, end] of ranges) { next += `${result.slice(cursor, start)}***`; cursor = end; }
    result = next + result.slice(cursor);
  }
  return result;
}

/** Keep the alphabet and length in sync with `zhin.js/instance` (chat-identity-bind). */
const CHAT_BIND_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHAT_BIND_CODE_LENGTH = 8;
const CHAT_BIND_HEAD = /^([^\p{L}\p{N}\s]{0,3}\s*(?:绑定|綁定|bind)(?:码|碼|\s*code)?)/iu;
/**
 * What may follow the keyword: up to three punctuation marks, the code as one word or two words
 * joined by whitespace or one `-`, up to three punctuation marks. The pieces never overlap (letters
 * and digits / whitespace / other marks), so matching stays linear (no polynomial backtracking).
 */
const CHAT_BIND_REST = /^\s*(?:[^\p{L}\p{N}\s]{1,3}\s*)?([\p{L}\p{N}]{1,8})(?:(?:\s+|-)([\p{L}\p{N}]{1,8}))?\s*(?:[^\p{L}\p{N}\s]{1,3}\s*)?$/u;
const CHAT_BIND_CODE_SHAPE = new RegExp(`^[${CHAT_BIND_CODE_ALPHABET}]{${CHAT_BIND_CODE_LENGTH}}$`, 'u');

function bindHead(candidate: string): string | undefined {
  const head = CHAT_BIND_HEAD.exec(candidate)?.[1];
  if (!head) return undefined;
  // Invisible characters (zero-width, format) and stray combining marks do not change what is read.
  const rest = candidate.slice(head.length).replace(/\p{Cf}/gu, '').normalize('NFKC').replace(/\p{M}/gu, '');
  const match = CHAT_BIND_REST.exec(rest);
  if (!match) return undefined;
  const typed = `${match[1]}${match[2] ?? ''}`.toUpperCase();
  // Every bind code holds a digit (`zhin.js/instance` redraws one without), so a word without one
  // (`username`, `ABCDEFGH`, `ME PLEASE`) is never a code.
  return /\p{N}/u.test(typed) && CHAT_BIND_CODE_SHAPE.test(typed) ? head : undefined;
}

/**
 * ADR 0060 §2.4 (#1250 sandbox-transcript-shared-bind-code): the bind message `text` with its code
 * replaced by `***` (`绑定 ABCD2345` → `绑定 ***`, `/bind abcd-2345` → `/bind ***`), or `text`
 * unchanged when it is not one. A bind message is the keyword `绑定` / `綁定` / `bind` (any letter
 * case; `码` / `code` may follow it) as the first word — after up to three punctuation marks (a
 * command prefix such as `/` or `#`, a quote) or `prefix` (the adapter's command prefix, which may
 * be a word, and is kept) — then the code and nothing else: up to three punctuation marks around it
 * (`<ABCD2345>`), written as one word or as two words joined by whitespace or `-`, that are, once
 * folded (NFKC, zero-width characters and combining marks dropped, upper case), exactly 8 symbols
 * of the bind-code alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), at least one of them a digit
 * (every bind code holds one; `username`, `ABCDEFGH` and `ME PLEASE` are words, not codes).
 *
 * Decided by the shape alone, never by whether such a code is open: an expired code is shown no
 * more than a live one. So an argument with the shape of a code (`绑定 23456789`) is hidden too,
 * while `bind username`, `绑定 ABCDEFGH`, `BIND ME PLEASE` and `bind a-b-c-d-e-f-g-h` are kept as
 * written.
 */
export function redactChatIdentityBindText(text: string, prefix = ''): string {
  if (!text) return text;
  const body = text.trim();
  if (prefix && body.startsWith(prefix)) {
    const rest = body.slice(prefix.length);
    const lead = rest.length - rest.trimStart().length;
    const head = bindHead(rest.trimStart());
    if (head) return `${prefix}${rest.slice(0, lead)}${head} ***`;
  }
  const head = bindHead(body);
  return head ? `${head} ***` : text;
}

/**
 * Whether `text` is a chat-identity bind message with a code-shaped argument, i.e. whether
 * {@link redactChatIdentityBindText} would change it (the same shape, the same `prefix`).
 */
export function isChatIdentityBindText(text: string, prefix = ''): boolean {
  return redactChatIdentityBindText(text, prefix) !== text;
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
  const text = redactSecretText(value);
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
