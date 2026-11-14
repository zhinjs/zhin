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
import { inspect } from 'node:util';
import { LOG_CONTENT_MAX_LENGTH, truncatePreview } from '@zhin.js/logger';

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


/** ICQQ SDK log levels from most to least verbose (`off` silences it). */
export const ICQQ_SDK_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'mark', 'off'] as const;
export type IcqqSdkLogLevel = typeof ICQQ_SDK_LOG_LEVELS[number];
/** Default `logLevel`: the SDK's warnings and errors, not its per-message `info` lines (#1250). */
export const DEFAULT_ICQQ_SDK_LOG_LEVEL: IcqqSdkLogLevel = 'warn';

export function isIcqqSdkLogLevel(value: unknown): value is IcqqSdkLogLevel {
  return typeof value === 'string' && (ICQQ_SDK_LOG_LEVELS as readonly string[]).includes(value);
}

/** The part of a Zhin logger the SDK bridge writes to. */
export interface IcqqSdkLogTarget {
  debug(message: string): unknown;
  info(message: string): unknown;
  warn(message: string): unknown;
  error(message: string): unknown;
}

/**
 * The SDK's per-message lines (`recv from: [Group: …] <full text>`, `succeed to send: […] …`) carry
 * chat content: they are logged at `debug`, whatever level the SDK used.
 */
const MESSAGE_DUMP = /^\s*(?:recv from|succeed to send|send to)\b/iu;
/** Longest SDK diagnostic kept on one line (message dumps use the shorter content cap). */
const SDK_LINE_MAX_LENGTH = 2000;

function sdkArgText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return inspect(value, { depth: 3, breakLength: Infinity });
  } catch {
    return String(value);
  }
}

const BRIDGED = Symbol('icqq.bridged-logger');

/**
 * Replaces the SDK's log4js logger with one that writes through the Zhin logger (#1250): one log
 * format, the Zhin logger's colour handling (no ANSI when the output is not a terminal), and
 * - `level` (the SDK's `log_level`, default {@link DEFAULT_ICQQ_SDK_LOG_LEVEL}) filters first;
 * - message dumps go to `debug`, so chat text is not written to disk at the default level;
 * - links and phone numbers are redacted ({@link redactIcqqLogText}), line breaks and control
 *   characters escaped and the line capped ({@link truncatePreview}), so a multi-line message
 *   cannot forge log lines.
 */
export function bridgeIcqqSdkLogger(target: IcqqSdkLogTarget, level: IcqqSdkLogLevel = DEFAULT_ICQQ_SDK_LOG_LEVEL): IcqqSdkLogger {
  let current: IcqqSdkLogLevel = level;
  const enabled = (at: number): boolean => current !== 'off' && at >= ICQQ_SDK_LOG_LEVELS.indexOf(current);
  const bridge = Object.create(null) as Record<Level, (...args: unknown[]) => void>;
  for (const sdkLevel of LEVELS) {
    bridge[sdkLevel] = (...args: unknown[]) => {
      const text = redactIcqqLogText(args.map(sdkArgText).join(' '));
      const dump = MESSAGE_DUMP.test(text);
      if (!enabled(dump ? ICQQ_SDK_LOG_LEVELS.indexOf('debug') : ICQQ_SDK_LOG_LEVELS.indexOf(sdkLevel))) return;
      const line = truncatePreview(text, dump ? LOG_CONTENT_MAX_LENGTH : SDK_LINE_MAX_LENGTH);
      if (dump || sdkLevel === 'trace' || sdkLevel === 'debug') target.debug(line);
      else if (sdkLevel === 'info' || sdkLevel === 'mark') target.info(line);
      else if (sdkLevel === 'warn') target.warn(line);
      else target.error(line);
    };
  }
  Object.defineProperty(bridge, 'level', {
    get: () => current,
    // `client.log_level = …` writes here; an unknown value keeps the current level.
    set: (value: unknown) => { if (isIcqqSdkLogLevel(value)) current = value; },
    enumerable: true,
  });
  Object.defineProperty(bridge, BRIDGED, { value: true });
  Object.defineProperty(bridge, REDACTED, { value: true });
  return bridge as unknown as IcqqSdkLogger;
}

export function isBridgedIcqqSdkLogger(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { [BRIDGED]?: true })[BRIDGED]);
}
