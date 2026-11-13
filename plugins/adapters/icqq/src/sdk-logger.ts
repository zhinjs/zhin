/**
 * Redacting wrapper for the ICQQ SDK's own logger.
 *
 * The SDK logs slider / device-lock / identity verification links (they carry a session id: `sid`,
 * `sig`, `uin-token`) and the account's phone number at `mark` level, which `log_level: 'info'`
 * does not suppress. The wrapper keeps every SDK diagnostic but strips link queries and phone
 * numbers before they reach the SDK's log4js logger.
 *
 * Not covered (SDK code that bypasses its logger): the terminal QR code drawing and the
 * `console.log(proto.toJSON())` of the legacy 237 branch; see the README "登录" section.
 */
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'mark'] as const;
type Level = typeof LEVELS[number];
const REDACTED = Symbol('icqq.redacted-logger');

export interface IcqqSdkLogger {
  level?: unknown;
  trace(...args: unknown[]): unknown;
  debug(...args: unknown[]): unknown;
  info(...args: unknown[]): unknown;
  warn(...args: unknown[]): unknown;
  error(...args: unknown[]): unknown;
  fatal(...args: unknown[]): unknown;
  mark(...args: unknown[]): unknown;
}

/** Links keep scheme, host and path; query and fragment become `…`. Phone numbers become `***`. */
export function redactIcqqLogText(text: string): string {
  return text
    .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/giu, '$1?…')
    // Masked (138****0000) and full mainland numbers, with or without a country code.
    .replace(/(?<![\w*])(?:\+?86[- ]?)?1\d{2}(?:\*{2,}|\d{4})\d{4}(?![\w*])/gu, '***')
    .replace(/(?<![\w*])\d{2,3}\*{2,}\d{2,4}(?![\w*])/gu, '***');
}

function redactArg(value: unknown): unknown {
  if (typeof value === 'string') return redactIcqqLogText(value);
  if (value instanceof Error) return redactIcqqLogText(value.stack ?? value.message);
  return value;
}

/** Wrap the SDK logger; `level` reads and writes through to the original. */
export function redactingIcqqLogger<T extends IcqqSdkLogger>(original: T): T {
  if ((original as { [REDACTED]?: true })[REDACTED]) return original;
  const wrapper = Object.create(null) as Record<Level, (...args: unknown[]) => unknown> & { level?: unknown; [REDACTED]?: true };
  for (const level of LEVELS) {
    wrapper[level] = (...args: unknown[]) => original[level](...args.map(redactArg));
  }
  Object.defineProperty(wrapper, 'level', {
    get: () => original.level,
    set: (value: unknown) => { original.level = value; },
    enumerable: true,
  });
  Object.defineProperty(wrapper, REDACTED, { value: true });
  return wrapper as unknown as T;
}

