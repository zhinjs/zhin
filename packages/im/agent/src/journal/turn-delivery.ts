import type { AgentRunIdentity } from '@zhin.js/ai/agent-stream';
import type { JournalStore } from '@zhin.js/ai/journal-store';
import type { ConversationRef, MessageRef } from '@zhin.js/im-contract';
import type { AgentOutputElement } from '../outbound/agent-output.js';
import type { DeliveryOutcome, ReplyPort, TurnOrigin } from '../turn/turn-ingress.js';
import { randomUUID } from 'node:crypto';

export interface TurnRecoveryIdentity {
  readonly run: AgentRunIdentity;
  readonly subjectId: string;
  readonly origin: Extract<TurnOrigin, { kind: 'im' }>;
}

export interface TurnDeliveryRecord extends TurnRecoveryIdentity {
  readonly attemptId?: string;
  readonly phase?: 'started' | 'settled';
  readonly recordedAt: number;
  readonly status: 'sent' | 'not_sent' | 'unknown' | 'partial';
  readonly outcome: DeliveryOutcome['status'] | 'threw' | 'pending' | 'unrecorded';
  readonly code?: string;
  readonly deliveryUnknown?: true;
  /** Ordered completed send slots; null retains an unconfirmed native identity. */
  readonly messages: readonly (MessageRef | null)[];
  readonly resources: readonly { readonly type: string; readonly url: string }[];
}

export interface StoredTurnResult {
  readonly turnId: string;
  readonly completedAt: number;
  readonly message: string;
  readonly deliveries: readonly TurnDeliveryRecord[];
}

export interface TurnResultCursor { readonly completedAt: number; readonly turnId: string; }
export interface TurnResultsPage {
  readonly results: readonly StoredTurnResult[];
  readonly hasMore: boolean;
  readonly nextCursor: TurnResultCursor | null;
}

export interface TurnDeliveryStore extends JournalStore {
  recordRecoveryIdentity(identity: TurnRecoveryIdentity): Promise<void>;
  recordDelivery(record: TurnDeliveryRecord): Promise<void>;
  listResults(sessionId: string, subjectId: string, conversation: ConversationRef): Promise<readonly StoredTurnResult[]>;
  readResultsPage(sessionId: string, subjectId: string, conversation: ConversationRef, before?: TurnResultCursor): Promise<TurnResultsPage>;
}

/** Records final projection facts; storage failures cannot replace a platform settlement. */
export function recordFinalReply(
  reply: ReplyPort,
  identity: TurnRecoveryIdentity,
  terminalCommitted: () => boolean,
  store: Pick<TurnDeliveryStore, 'recordDelivery'>,
  warn: () => void,
): ReplyPort {
  return Object.freeze({
    ...(reply.segments ? { segments: reply.segments } : {}),
    async send(output: readonly AgentOutputElement[]) {
      // Progress sends enter before terminal and must never become final result receipts.
      const final = terminalCommitted();
      const resources = final ? resultResources(output) : [];
      const attemptId = final ? randomUUID() : undefined;
      if (final) await persist({ ...identity, attemptId, phase: 'started', recordedAt: Date.now(), status: 'unknown', outcome: 'pending', messages: [], resources });
      let outcome: DeliveryOutcome;
      try { outcome = await reply.send(output); }
      catch (error) {
        if (final) await persist({ ...identity, attemptId, phase: 'settled', recordedAt: Date.now(), status: 'unknown', outcome: 'threw', messages: [], resources });
        throw error;
      }
      if (final) {
        const messages = 'messages' in outcome ? outcome.messages ?? [] : [];
        await persist({ ...identity, attemptId, phase: 'settled', recordedAt: Date.now(), outcome: outcome.status,
          status: outcome.status === 'sent' ? 'sent' : messages.length || outcome.status === 'failed' && outcome.deliveryPartial ? 'partial'
            : outcome.status === 'failed' && outcome.deliveryUnknown ? 'unknown' : 'not_sent',
          ...('code' in outcome ? { code: outcome.code } : {}),
          ...(outcome.status === 'failed' && outcome.deliveryUnknown ? { deliveryUnknown: true as const } : {}), messages, resources });
      }
      return outcome;
    },
  });
  async function persist(record: TurnDeliveryRecord) {
    try { await store.recordDelivery(record); }
    catch { try { warn(); } catch { /* Diagnostics cannot replace a delivery settlement. */ } }
  }
}

export function resultResources(output: readonly AgentOutputElement[]): TurnDeliveryRecord['resources'] {
  const refs: { type: string; url: string }[] = [];
  const add = (type: string, value: unknown) => {
    if (typeof value !== 'string') return;
    try {
      const url = new URL(value);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) refs.push({ type, url: value });
    } catch { /* Local bytes and local paths are not navigation references. */ }
  };
  for (const element of output) {
    if (element.type === 'message') {
      for (const segment of element.segments) {
        if (!['image', 'audio', 'video', 'file'].includes(segment.type)) continue;
        const media = (segment.data as Readonly<Record<string, unknown>>).media as { kind?: unknown; value?: unknown } | undefined;
        if (media?.kind === 'url') add(segment.type, media.value);
      }
    } else if (['image', 'audio', 'video', 'file'].includes(element.type) && 'url' in element) add(element.type, element.url);
  }
  return refs;
}
