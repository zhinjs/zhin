/**
 * Why a Console `endpoint.send_message` did not deliver (#1250).
 *
 * The RPC reply keeps its `error` string (older clients show it as before) and adds a
 * {@link ConsoleSendFailure} under `data`, so the Console can show a specific, localized reason
 * instead of the generic "Outbound delivery failed.".
 */
export type ConsoleSendFailureReason =
  /** The Endpoint has no live client / subscriber for the conversation (e.g. no Sandbox tab open on it). */
  | 'no_live_client'
  /** The Endpoint is not connected, logged out, or stopped. */
  | 'endpoint_offline'
  /** No Endpoint with that adapter / key exists in the running instance. */
  | 'endpoint_not_found'
  /** The platform does not know the target conversation or user. */
  | 'target_not_found'
  /** Outbound middleware or a send policy refused or suppressed the message. */
  | 'policy_rejected'
  /** The platform refused the message. */
  | 'platform_rejected'
  /** The Endpoint cannot send this kind of message or to this kind of conversation. */
  | 'unsupported'
  /** The content could not be rendered or is not valid for the platform. */
  | 'invalid_content'
  /** The platform may have accepted the message; resending can duplicate it. */
  | 'delivery_unknown'
  /** Any other failure; `code` carries the machine-readable detail. */
  | 'failed';

/** Delivery status of the failed attempt (the canonical `DeliveryReceipt.status`, or `unknown`). */
export type ConsoleSendFailureStatus = 'failed' | 'rejected' | 'unsupported' | 'suppressed' | 'unknown';

/** `data` of a failed `endpoint.send_message` reply. */
export interface ConsoleSendFailure {
  /** Machine-readable failure code from the delivery receipt / Endpoint (e.g. `sandbox_delivery_unavailable`). */
  readonly code: string;
  readonly reason: ConsoleSendFailureReason;
  readonly status?: ConsoleSendFailureStatus;
  /** True only when the Endpoint says a retry is safe. */
  readonly retryable?: boolean;
}

/** Display text (Chinese) for each reason. */
export const CONSOLE_SEND_FAILURE_MESSAGES: Readonly<Record<ConsoleSendFailureReason, string>> = Object.freeze({
  no_live_client: '发送失败：该会话没有在线的客户端（例如没有打开对应的 Sandbox 会话）',
  endpoint_offline: '发送失败：账号未连接或未登录',
  endpoint_not_found: '发送失败：找不到该账号',
  target_not_found: '发送失败：目标会话或用户不存在',
  policy_rejected: '发送失败：消息被发送策略或中间件拒绝',
  platform_rejected: '发送失败：平台拒绝了这条消息',
  unsupported: '发送失败：该账号不支持发送这类消息',
  invalid_content: '发送失败：消息内容无效或无法渲染',
  delivery_unknown: '发送结果未知：平台可能已收到，请勿重复发送',
  failed: '发送失败',
});

const REASON_BY_CODE: Readonly<Record<string, ConsoleSendFailureReason>> = Object.freeze({
  sandbox_delivery_unavailable: 'no_live_client',
  session_unavailable: 'no_live_client',
  endpoint_inactive: 'endpoint_offline',
  endpoint_disconnected: 'endpoint_offline',
  endpoint_timeout: 'endpoint_offline',
  not_logged_in: 'endpoint_offline',
  token_unavailable: 'endpoint_offline',
  send_disabled: 'endpoint_offline',
  endpoint_not_found: 'endpoint_not_found',
  endpoint_identity_mismatch: 'endpoint_not_found',
  invalid_recipient: 'target_not_found',
  target_not_found: 'target_not_found',
  target_error: 'target_not_found',
  reply_blocked: 'policy_rejected',
  reply_suppressed: 'policy_rejected',
  outbound_suppressed: 'policy_rejected',
  outbound_middleware_failed: 'policy_rejected',
  approval_pending: 'policy_rejected',
  platform_rejected: 'platform_rejected',
  outbound_payload_rejected: 'platform_rejected',
  rate_limited: 'platform_rejected',
  outbound_unsupported: 'unsupported',
  unsupported_operation: 'unsupported',
  unsupported_media: 'unsupported',
  not_implemented: 'unsupported',
  invalid_payload: 'invalid_content',
  outbound_payload_empty: 'invalid_content',
  media_download_failed: 'invalid_content',
  delivery_unconfirmed: 'delivery_unknown',
});

/** Map a delivery failure code (and receipt status) to a {@link ConsoleSendFailureReason}. */
export function classifyConsoleSendFailure(code: string, status?: ConsoleSendFailureStatus): ConsoleSendFailureReason {
  // An unconfirmed delivery must never read as a safe "not sent", whatever its code.
  if (status === 'unknown') return 'delivery_unknown';
  const known = Object.prototype.hasOwnProperty.call(REASON_BY_CODE, code) ? REASON_BY_CODE[code] : undefined;
  if (known) return known;
  if (status === 'suppressed') return 'policy_rejected';
  if (status === 'unsupported') return 'unsupported';
  if (status === 'rejected') return 'platform_rejected';
  return 'failed';
}

/** True when an `endpoint.send_message` failure `data` carries a classified reason. */
export function isConsoleSendFailure(value: unknown): value is ConsoleSendFailure {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { code?: unknown; reason?: unknown };
  return typeof record.code === 'string' && typeof record.reason === 'string'
    && Object.prototype.hasOwnProperty.call(CONSOLE_SEND_FAILURE_MESSAGES, record.reason);
}
