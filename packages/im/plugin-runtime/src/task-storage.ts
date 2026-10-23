import { normalizeDeliveryTarget, type DeliveryTarget } from './delivery-target.js';

/** Reversible SQL text encoding, including endpoint ids containing NUL. */
export function encodeStorageIdentity(value: string): string {
  return `k1:${value.replaceAll('%', '%25').replaceAll('\0', '%00')}`;
}
export function decodeStorageIdentity(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('k1:')) throw new Error('Invalid stored identity');
  return value.slice(3).replaceAll('%00', '\0').replaceAll('%25', '%');
}

export const TASK_TARGET_COLUMNS = {
  endpoint_adapter: { type: 'text', nullable: false }, endpoint_id: { type: 'text', nullable: false },
  conversation_kind: { type: 'text', nullable: false }, conversation_id: { type: 'text', nullable: false },
  parent_kind: { type: 'text', nullable: true }, parent_id: { type: 'text', nullable: true },
  thread_id: { type: 'text', nullable: true },
} as const;

export function encodeTaskTarget(target: DeliveryTarget): Record<string, unknown> {
  const value = normalizeDeliveryTarget(target);
  return { endpoint_adapter: encodeStorageIdentity(value.endpoint.adapter), endpoint_id: encodeStorageIdentity(value.endpoint.id),
    conversation_kind: value.kind, conversation_id: encodeStorageIdentity(value.id),
    parent_kind: value.parent?.kind ?? null, parent_id: value.parent ? encodeStorageIdentity(value.parent.id) : null,
    thread_id: value.threadId === undefined ? null : encodeStorageIdentity(value.threadId) };
}
export function decodeTaskTarget(row: Record<string, unknown>): DeliveryTarget {
  return normalizeDeliveryTarget({ endpoint: { adapter: decodeStorageIdentity(row.endpoint_adapter), id: decodeStorageIdentity(row.endpoint_id) },
    kind: row.conversation_kind, id: decodeStorageIdentity(row.conversation_id),
    ...(row.parent_kind == null ? {} : { parent: { kind: row.parent_kind, id: decodeStorageIdentity(row.parent_id) } }),
    ...(row.thread_id == null ? {} : { threadId: decodeStorageIdentity(row.thread_id) }) });
}

export const TASK_RECEIPT_COLUMNS = {
  id: { type: 'text', length: 128, primary: true }, position: { type: 'integer', nullable: false },
  fingerprint: { type: 'text', length: 64, nullable: false }, task_id: { type: 'text', length: 128, nullable: false },
  operation: { type: 'text', length: 32, nullable: false },
} as const;
export function encodeTaskReceipts(receipts: readonly { id: string; fingerprint: string; taskId: string; operation: string }[]): Record<string, unknown>[] {
  return receipts.map((receipt, position) => ({ id: receipt.id, fingerprint: receipt.fingerprint,
    task_id: receipt.taskId, operation: receipt.operation, position }));
}
export function decodeTaskReceipts(rows: readonly Record<string, unknown>[]): { id: string; fingerprint: string; taskId: string; operation: string }[] {
  return rows.map(row => ({ id: String(row.id), fingerprint: String(row.fingerprint), taskId: String(row.task_id), operation: String(row.operation) }));
}
