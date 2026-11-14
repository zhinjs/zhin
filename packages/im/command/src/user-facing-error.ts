import type { Locale } from '@zhin.js/plugin-runtime';

/**
 * Brand shared across duplicated package copies: recognition never relies on `instanceof`.
 * @internal Authors extend {@link UserFacingError}; the brand is the cross-copy protocol.
 */
export const userFacingErrorBrand: unique symbol = Symbol.for('zhin.command.user-facing-error/1');

/**
 * An expected, user-caused refusal raised while a Command runs (e.g. "you already have an active
 * game here"). Command dispatch turns it into the command's reply through the normal outbound
 * chain instead of failing the inbound message. `message` (or `format(locale)`) must be safe to
 * show to the sender: never put stack traces, internal ids or raw upstream errors in it.
 */
export class UserFacingError extends Error {
  readonly [userFacingErrorBrand] = true as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UserFacingError';
  }

  /** Localized sender-facing text. Defaults to `message`. */
  format(_locale?: Locale): string {
    return this.message;
  }
}

/** True for a {@link UserFacingError} from any package copy. */
export function isUserFacingError(error: unknown): error is UserFacingError {
  return error instanceof Error && (error as { [userFacingErrorBrand]?: unknown })[userFacingErrorBrand] === true;
}

/** Sender-facing text of a {@link UserFacingError}; `undefined` for every other value. */
export function userFacingErrorText(error: unknown, locale?: Locale): string | undefined {
  if (!isUserFacingError(error)) return undefined;
  let text: unknown;
  try {
    text = typeof error.format === 'function' ? error.format(locale) : error.message;
  } catch {
    text = error.message;
  }
  return typeof text === 'string' && text.trim() ? text : undefined;
}
