import { randomBytes } from 'node:crypto';
import { jsonResponse } from '@zhin.js/host-http';
import {
  CONSOLE_INTERNAL_ERROR_MESSAGE,
  type ConsoleApiErrorBody,
  type ConsoleApiErrorCode,
} from '@zhin.js/console-protocol';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('console');

/** Message of an unexpected failure: logged here, never sent to the client. */
export const INTERNAL_ERROR_MESSAGE = CONSOLE_INTERNAL_ERROR_MESSAGE;

/** A fresh log correlation id (`err_` + 12 hex), matching `CONSOLE_ERROR_ID_PATTERN`. */
export function createErrorId(): string {
  return `err_${randomBytes(6).toString('hex')}`;
}

/**
 * A JSON error response for an unexpected failure. The error detail (message) is logged
 * server-side under a correlation id; the client only sees a stable code, a generic message and
 * that id (`errorId`), which `zhin logs` finds in the instance log (#1250).
 */
export function internalErrorResponse(
  status: number,
  op: string,
  error: unknown,
  extra: Readonly<Record<string, unknown>> = {},
): Response {
  const errorId = logInternalError(op, error);
  return jsonResponse(status, { success: false, code: 'internal_error', ...extra, error: INTERNAL_ERROR_MESSAGE, errorId });
}

/** Logs an unexpected failure server-side (message only) and returns its correlation id. */
export function logInternalError(op: string, error: unknown): string {
  const errorId = createErrorId();
  logger.warn(formatCompact({ op, errorId, error: error instanceof Error ? error.message : String(error) }));
  return errorId;
}

/**
 * A JSON error response for an expected failure (#1250): a stable code and a user-facing
 * explanation, plus an optional structured `data`. Never pass an exception message here.
 */
export function expectedErrorResponse<TData>(
  status: number,
  code: ConsoleApiErrorCode,
  error: string,
  data?: TData,
): Response {
  const body: ConsoleApiErrorBody<TData> = { success: false, code, error, ...(data === undefined ? {} : { data }) };
  return jsonResponse(status, body);
}
