/**
 * Hosted captcha helper (ADR 0058 §验证引导与辅助材料). Pure and browser-safe: shared by the Console,
 * SDKs and tests. No Node built-ins.
 *
 * The opener (Console) opens `${helperUrl}#${payload}` in a popup. The helper page runs on its own
 * origin, loads the provider's captcha with `payload.q`, and on success posts
 * `{ type: LOGIN_CAPTCHA_MESSAGE_TYPE, nonce, ticket, randstr }` to `window.opener` at `payload.o`.
 * The opener accepts it only from the helper origin and with its own nonce.
 */

/** `postMessage` type the helper page sends back. */
export const LOGIN_CAPTCHA_MESSAGE_TYPE = 'zhin.login-assist.captcha' as const;

/** Default hosted helper page (separate origin from any Console). */
export const DEFAULT_CAPTCHA_HELPER_URL = 'https://zhin.js.org/login-assist/tcaptcha.html';

/** `media.captcha` of a slider challenge. */
export interface LoginCaptchaMedia {
  readonly provider: 'tencent';
  /** Query string of the platform's slider URL, verbatim. */
  readonly query: string;
  /** Overrides the default (or host-configured) helper page. */
  readonly helperUrl?: string;
}

/** Fragment payload of the helper URL. */
export interface LoginCaptchaHelperPayload {
  /** Provider query string. */
  readonly q: string;
  /** Opener nonce, echoed back. */
  readonly n: string;
  /** Opener origin, the only `postMessage` target. */
  readonly o: string;
}

export interface BuildCaptchaHelperUrlInput {
  readonly helperUrl?: string;
  readonly query: string;
  readonly nonce: string;
  /** Origin of the opener (`location.origin`). */
  readonly origin: string;
}

/**
 * `${helperUrl}#${base64url(JSON {q, n, o})}`. The payload goes in the fragment so it never reaches
 * a server log. Throws on a non-https helper (http only for localhost) or an invalid origin.
 */
export function buildCaptchaHelperUrl(input: BuildCaptchaHelperUrlInput): string {
  const helper = validHelperUrl(input.helperUrl ?? DEFAULT_CAPTCHA_HELPER_URL);
  if (!helper) throw new TypeError('captcha helper URL must be https (http only on localhost)');
  const origin = validOrigin(input.origin);
  if (!origin) throw new TypeError('opener origin is invalid');
  if (typeof input.nonce !== 'string' || input.nonce.length < 8) throw new TypeError('nonce must have at least 8 characters');
  const query = typeof input.query === 'string' ? input.query.replace(/^\?/u, '') : '';
  if (!query) throw new TypeError('captcha query is required');
  helper.hash = encodeBase64Url(JSON.stringify({ q: query, n: input.nonce, o: origin } satisfies LoginCaptchaHelperPayload));
  return helper.toString();
}

/** Decodes the fragment payload on the helper page (`location.hash`); `null` when malformed. */
export function parseCaptchaHelperPayload(hash: string): LoginCaptchaHelperPayload | null {
  try {
    const parsed = JSON.parse(decodeBase64Url(hash.replace(/^#/u, ''))) as Record<string, unknown>;
    if (typeof parsed.q !== 'string' || !parsed.q || typeof parsed.n !== 'string' || !parsed.n) return null;
    const origin = typeof parsed.o === 'string' ? validOrigin(parsed.o) : null;
    return origin ? Object.freeze({ q: parsed.q, n: parsed.n, o: origin }) : null;
  } catch {
    return null;
  }
}

/**
 * Accepts a helper `message` event only from `helperOrigin` and with the expected nonce.
 * Returns the ticket and randstr, or `null`.
 */
export function parseCaptchaHelperMessage(
  event: { readonly origin: string; readonly data: unknown },
  expected: { readonly helperOrigin: string; readonly nonce: string },
): { readonly ticket: string; readonly randstr: string } | null {
  if (!event || event.origin !== expected.helperOrigin || !expected.nonce) return null;
  const data = event.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || data.type !== LOGIN_CAPTCHA_MESSAGE_TYPE || data.nonce !== expected.nonce) return null;
  const ticket = typeof data.ticket === 'string' ? data.ticket.trim() : '';
  const randstr = typeof data.randstr === 'string' ? data.randstr.trim() : '';
  if (!ticket || /[\s,]/u.test(ticket) || /[\s,]/u.test(randstr) || ticket.length > 4096 || randstr.length > 256) return null;
  return Object.freeze({ ticket, randstr });
}

/** Origin of a helper URL (for `parseCaptchaHelperMessage`); `null` when invalid. */
export function captchaHelperOrigin(helperUrl: string = DEFAULT_CAPTCHA_HELPER_URL): string | null {
  return validHelperUrl(helperUrl)?.origin ?? null;
}

/** Whether a configured helper URL is usable (https, or http on localhost). */
export function isValidCaptchaHelperUrl(value: unknown): value is string {
  return typeof value === 'string' && validHelperUrl(value) !== null;
}

function validHelperUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    if (url.username || url.password) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function validOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin === value.replace(/\/$/u, '') ? url.origin : null;
  } catch {
    return null;
  }
}

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function decodeBase64Url(text: string): string {
  const base64 = text.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}
