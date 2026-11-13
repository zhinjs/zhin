/**
 * ICQQ `system.login.error` → LoginAssist error codes (ADR 0058 §5).
 *
 * One table: exact SDK codes first (`LoginErrorCode` of the legacy wtlogin path, `NTLoginErrorCode`
 * of the NT path), then message patterns for errors the SDK only reports as text. The platform's
 * message is kept only as a sanitized single line (no control characters, no local file paths).
 */
import type { Locale } from 'zhin.js/i18n';
import type { LoginErrorCode, LoginNextAction } from '@zhin.js/core';
import { messages as t } from './i18n.js';

export interface IcqqLoginErrorRule {
  /** Exact SDK error codes. */
  readonly codes?: readonly number[];
  /** Matched against the SDK message when no code rule applies. */
  readonly pattern?: RegExp;
  readonly code: LoginErrorCode;
  readonly next: LoginNextAction;
  /** What the SDK means (documentation). */
  readonly note: string;
}

/** Ordered: the first matching rule wins; code rules are checked before message rules. */
export const ICQQ_LOGIN_ERROR_TABLE: readonly IcqqLoginErrorRule[] = Object.freeze([
  // --- exact codes ---
  { codes: [1, 140022013, 150022029, 150022032, 123456], code: 'credential_invalid', next: 'relogin',
    note: 'WrongPassword / AccountOrPasswordError / MultiplePasswordIncorrect / PasswordModifiedDuringLogin / token incompatible' },
  { codes: [140022009], code: 'credential_invalid', next: 'relogin', note: 'RefusePasswordLogin (log in by QR code instead)' },
  { codes: [163, 150022026, 140022016], code: 'code_invalid', next: 'retry_input', note: 'WrongSmsCode / SmsInvalid / IllegalTicket' },
  { codes: [162, 150022022, 150022023], code: 'rate_limited', next: 'wait', note: 'TooManySms / TooOften / TooManyTimesToday' },
  { codes: [40, 235, 140022005, 140022019, 150022021, 150022030, 150022033], code: 'risk_blocked', next: 'none',
    note: 'AccountFrozen / device blacklisted / Frozen / NeedVerifyRealName / BlackAccount / IllegalAccount / LhrEfundFreeze' },
  { codes: [140022014, 150022035, 150022039], code: 'challenge_expired', next: 'relogin', note: 'ExpireTicket / LongTimeOfNoOperation / CookieExpired' },
  { codes: [140022002, 140022003, 150022031], code: 'network', next: 'wait', note: 'SystemFailed / TimeoutRetry / InterfaceUnavailable' },
  // --- message patterns (the SDK reuses codes such as 237 for different texts) ---
  { pattern: /频繁|频率|too (?:many|often)|frequent/iu, code: 'rate_limited', next: 'wait', note: 'too frequent' },
  { pattern: /冻结|拉黑|封禁|封号|风险|风控|安全原因|frozen|blocked/iu, code: 'risk_blocked', next: 'none', note: 'risk control' },
  { pattern: /验证码(?:错误|不正确|无效)|ticket|wrong code/iu, code: 'code_invalid', next: 'retry_input', note: 'wrong code' },
  { pattern: /密码|password/iu, code: 'credential_invalid', next: 'relogin', note: 'password' },
  { pattern: /过期|超时|expired|timed? ?out/iu, code: 'challenge_expired', next: 'relogin', note: 'expired' },
  { pattern: /网络|繁忙|network|busy/iu, code: 'network', next: 'wait', note: 'network' },
]);

export interface IcqqLoginErrorMapping {
  readonly code: LoginErrorCode;
  readonly next: LoginNextAction;
  /** Sanitized platform message, or a localized label when the SDK gave none. */
  readonly message: string;
  /** The SDK code, for logs. */
  readonly platformCode?: number;
}

const LABEL_KEYS = {
  code_invalid: 'loginErrorCodeInvalid',
  rate_limited: 'loginErrorRateLimited',
  challenge_expired: 'loginErrorExpired',
  risk_blocked: 'loginErrorRisk',
  credential_invalid: 'loginErrorCredential',
  network: 'loginErrorNetwork',
  unknown: 'loginErrorUnknown',
} as const satisfies Record<LoginErrorCode, string>;

/** Map one `system.login.error` payload (`{ code, message }`). */
export function mapIcqqLoginError(event: unknown, locale?: Locale): IcqqLoginErrorMapping {
  const raw = event && typeof event === 'object' ? event as { code?: unknown; message?: unknown } : {};
  const platformCode = typeof raw.code === 'number' && Number.isFinite(raw.code) ? raw.code : undefined;
  const text = typeof raw.message === 'string' ? raw.message : '';
  const rule = ICQQ_LOGIN_ERROR_TABLE.find((item) => platformCode !== undefined && item.codes?.includes(platformCode))
    ?? ICQQ_LOGIN_ERROR_TABLE.find((item) => item.pattern && text && item.pattern.test(text));
  const code: LoginErrorCode = rule?.code ?? 'unknown';
  return Object.freeze({
    code,
    next: rule?.next ?? 'relogin',
    message: sanitizeIcqqLoginMessage(text) || t(locale, LABEL_KEYS[code]),
    ...(platformCode !== undefined ? { platformCode } : {}),
  });
}

/** Localized label of an error code. */
export function icqqLoginErrorLabel(code: LoginErrorCode, locale?: Locale): string {
  return t(locale, LABEL_KEYS[code]);
}

/** Classify a failed `sendSmsCode()`: too frequent → `rate_limited`, anything else `unknown`. */
export function classifyIcqqSmsFailure(error: unknown): Extract<LoginErrorCode, 'rate_limited' | 'unknown'> {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'number'
    ? (error as { code: number }).code : undefined;
  if (code === 162 || /频繁|频率|上限|too (?:many|often)|frequent|limit/iu.test(text)) return 'rate_limited';
  return 'unknown';
}

/**
 * One line, no control characters, local file paths replaced, at most 200 characters.
 * (The device-blacklist message embeds the absolute path of `device.json`.)
 */
export function sanitizeIcqqLoginMessage(value: unknown): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let text = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  text = text
    .replace(/(["'“”])(?:[A-Za-z]:)?[\\/][^"'“”]*\1/gu, '$1…$1')
    .replace(/(?:^|(?<=\s))(?:[A-Za-z]:)?(?:[\\/][\w.@-]+){2,}/gu, '…');
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}
