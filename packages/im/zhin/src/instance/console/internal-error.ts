import { jsonResponse } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('console');

/** Message of an unexpected failure: logged here, never sent to the client. */
export const INTERNAL_ERROR_MESSAGE = 'Internal error';

/**
 * A JSON error response for an unexpected failure. The error detail (message, stack) is
 * logged server-side; the client only sees a stable code and a generic message.
 */
export function internalErrorResponse(
  status: number,
  op: string,
  error: unknown,
  extra: Readonly<Record<string, unknown>> = {},
): Response {
  logInternalError(op, error);
  return jsonResponse(status, { success: false, code: 'internal_error', ...extra, error: INTERNAL_ERROR_MESSAGE });
}

/** Logs an unexpected failure server-side (message only). */
export function logInternalError(op: string, error: unknown): void {
  logger.warn(formatCompact({ op, error: error instanceof Error ? error.message : String(error) }));
}
