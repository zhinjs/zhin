import type { MessageSegment } from '@zhin.js/client';
import { captureSandboxRequestContext, type SandboxRequestContext } from './sandboxTransport.js';

export interface PendingInteraction {
  readonly id: string;
  readonly generation: number;
  readonly subjectId: string;
  readonly expiresAt: number;
  readonly segments: MessageSegment[];
}

export interface RecoveredDelivery {
  readonly status: 'sent' | 'not_sent' | 'unknown' | 'partial';
  readonly deliveryUnknown?: true;
  readonly recordedAt: number;
  readonly messages: readonly (Readonly<{ id: string }> | null)[];
  readonly resources: readonly Readonly<{ type: string; url: string }>[];
}

export interface RecoveredResult {
  readonly turnId: string;
  readonly completedAt: number;
  readonly message: string;
  readonly deliveries: readonly RecoveredDelivery[];
}

export interface RecoveredResultPage {
  readonly sessionKey: string;
  readonly results: readonly RecoveredResult[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/** Read-only recovery never sends a message, answers a prompt, or retries execution. */
async function readRecovery<T>(path: string, connectionId: string, sessionKey: string, signal?: AbortSignal, cursor?: string,
  context: SandboxRequestContext = captureSandboxRequestContext()): Promise<T | null> {
  const url = new URL(path, `${context.apiBase || window.location.origin}/`);
  url.searchParams.set('connectionId', connectionId);
  url.searchParams.set('sessionKey', sessionKey);
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await fetch(url, { headers: context.headers, cache: 'no-store', signal });
  if (response.status === 404 || response.status === 405) return null;
  const body = await response.json() as { success?: boolean; data?: T; error?: string };
  if (!response.ok || !body.success || !body.data) throw new Error(body.error || `Conversation recovery failed (${response.status})`);
  return body.data;
}

export function readPendingInteractions(connectionId: string, sessionKey: string, signal?: AbortSignal, context?: SandboxRequestContext) {
  return readRecovery<{ generation: number; pending: readonly PendingInteraction[] }>('/api/interactions/pending', connectionId, sessionKey, signal, undefined, context);
}

export function readConversationResults(connectionId: string, sessionKey: string, signal?: AbortSignal, cursor?: string, context?: SandboxRequestContext) {
  return readRecovery<RecoveredResultPage>('/api/conversations/results', connectionId, sessionKey, signal, cursor, context);
}

export function resultDeliveryStatus(result: RecoveredResult): RecoveredDelivery['status'] {
  const statuses = result.deliveries.map(delivery => delivery.status);
  if (!statuses.length || statuses.includes('unknown') || result.deliveries.some(delivery => delivery.deliveryUnknown)) return 'unknown';
  if (statuses.includes('partial') || statuses.includes('sent') && statuses.includes('not_sent')) return 'partial';
  return statuses.every(status => status === 'sent') ? 'sent' : 'not_sent';
}

export function prependResultPage(previous: RecoveredResultPage, earlier: RecoveredResultPage): RecoveredResultPage {
  if (previous.sessionKey !== earlier.sessionKey) throw new Error('Result page belongs to another conversation');
  const rows = new Map(previous.results.map(result => [result.turnId, result]));
  for (const result of earlier.results) if (!rows.has(result.turnId)) rows.set(result.turnId, result);
  return { ...earlier, results: [...rows.values()].sort((a, b) => a.completedAt - b.completedAt || a.turnId.localeCompare(b.turnId)) };
}
