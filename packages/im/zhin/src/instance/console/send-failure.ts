import {
  classifyConsoleSendFailure,
  type ConsoleSendFailure,
  type ConsoleSendFailureStatus,
} from '@zhin.js/console-protocol';

const SEND_FAILURE_STATUSES: ReadonlySet<string> = new Set(['failed', 'rejected', 'unsupported', 'suppressed']);
const DISPOSITIONS: ReadonlySet<string> = new Set(['not_sent', 'rejected', 'unknown']);

/**
 * Classifies an expected outbound failure (#1250), or `undefined` for an unexpected exception.
 *
 * Read structurally: Core's `EndpointDeliveryError` carries a string `code`, a `disposition` and
 * the canonical receipt; `endpoint not found` is the Endpoint directory's plain error. Only the
 * code, the delivery status and the retry hint leave the instance — never the error message.
 */
export function consoleSendFailure(error: unknown): ConsoleSendFailure | undefined {
  if (!(error instanceof Error)) return undefined;
  const record = error as Error & { code?: unknown; disposition?: unknown; receipt?: unknown };
  if (typeof record.code !== 'string' || !record.code || typeof record.disposition !== 'string' || !DISPOSITIONS.has(record.disposition)) {
    return error.message === 'endpoint not found'
      ? { code: 'endpoint_not_found', reason: 'endpoint_not_found', status: 'failed' }
      : undefined;
  }
  const receipt = record.receipt && typeof record.receipt === 'object'
    ? record.receipt as { status?: unknown; failure?: { retryable?: unknown; deliveryUnknown?: unknown } }
    : undefined;
  const status: ConsoleSendFailureStatus = record.disposition === 'unknown' || receipt?.failure?.deliveryUnknown === true
    ? 'unknown'
    : typeof receipt?.status === 'string' && SEND_FAILURE_STATUSES.has(receipt.status)
      ? receipt.status as ConsoleSendFailureStatus
      : record.disposition === 'rejected' ? 'rejected' : 'failed';
  return {
    code: record.code,
    reason: classifyConsoleSendFailure(record.code, status),
    status,
    ...(receipt?.failure?.retryable === true ? { retryable: true } : {}),
  };
}
