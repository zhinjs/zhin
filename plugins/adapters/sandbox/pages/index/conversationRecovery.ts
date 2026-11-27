import type { MessageSegment, ConsoleLocale } from '@zhin.js/client';
import { captureSandboxRequestContext, type SandboxRequestContext } from './sandboxTransport.js';

/** How the Host says a recovered prompt is answered: by anyone, or by the exact sender it asked. */
export type PendingInteractionAnswerer = Readonly<{ kind: 'anyone' }> | Readonly<{ kind: 'sender'; senderId: string }>;

export interface PendingInteraction {
  readonly id: string;
  readonly generation: number;
  readonly expiresAt: number;
  readonly segments: MessageSegment[];
  /** Absent on an older Host (owner-only read): the click then uses the page's current speaker. */
  readonly answerAs?: PendingInteractionAnswerer;
}

/** The Host's answerer field, or undefined when it is missing or malformed (never a guessed sender). */
export function readPendingAnswerer(value: unknown): PendingInteractionAnswerer | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.kind === 'anyone') return { kind: 'anyone' };
  return item.kind === 'sender' && typeof item.senderId === 'string' && item.senderId.trim()
    ? { kind: 'sender', senderId: item.senderId.slice(0, 256) } : undefined;
}

/** `SANDBOX_SIMULATED_PREFIX` of `src/protocol.ts` (a Node module the page cannot import); a test keeps them equal. */
export const SANDBOX_PAGE_SIMULATED_PREFIX = '~sim:';

/**
 * The speaker fields a click on a recovered prompt carries. A prompt asked of a simulated speaker
 * (`~sim:<id>`) is answered as that speaker — the Host keeps a `~sim:` id as is — whatever the page's
 * sender box says now; one asked of a real chat identity is answered with 「以我的聊天身份发言」.
 * The Host still decides whether this socket's speaker may answer; nothing here grants it.
 */
export function recoveredAnswerSpeaker(answerAs: PendingInteractionAnswerer | undefined, simulatedPrefix = SANDBOX_PAGE_SIMULATED_PREFIX):
  Readonly<{ senderId: string; asMe: false }> | Readonly<{ asMe: true }> | undefined {
  if (!answerAs || answerAs.kind === 'anyone') return undefined;
  return answerAs.senderId.startsWith(simulatedPrefix) ? { senderId: answerAs.senderId, asMe: false } : { asMe: true };
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

export async function readPendingInteractions(connectionId: string, sessionKey: string, signal?: AbortSignal, context?: SandboxRequestContext) {
  const data = await readRecovery<{ generation: number; pending: readonly PendingInteraction[] }>('/api/interactions/pending', connectionId, sessionKey, signal, undefined, context);
  if (!data || !Array.isArray(data.pending)) return data;
  return { ...data, pending: data.pending.map(({ answerAs, ...interaction }) => {
    const answerer = readPendingAnswerer(answerAs);
    return answerer ? { ...interaction, answerAs: answerer } : interaction;
  }) };
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

/** One settled inbound outcome (ADR 0061) as `GET /api/conversations/outcomes` returns it (#1250). */
export interface ConversationOutcome {
  readonly id: string;
  readonly messageId?: string;
  readonly settledAt: number;
  readonly outcome: string;
  readonly reason?: string;
  readonly stage: string;
  readonly addressed: boolean;
  readonly reply: 'yes' | 'no' | 'throttled';
  readonly text: string;
}

/**
 * Why one sent message got (or did not get) a reply: `null` on a Host without the route,
 * `undefined` while the message is still being processed (not settled yet).
 */
export async function readMessageOutcome(connectionId: string, sessionKey: string, messageId: string, locale: ConsoleLocale,
  signal?: AbortSignal, context: SandboxRequestContext = captureSandboxRequestContext()): Promise<ConversationOutcome | null | undefined> {
  const url = new URL('/api/conversations/outcomes', `${context.apiBase || window.location.origin}/`);
  url.searchParams.set('connectionId', connectionId);
  url.searchParams.set('sessionKey', sessionKey);
  url.searchParams.set('messageId', messageId);
  url.searchParams.set('locale', locale);
  const response = await fetch(url, { headers: context.headers, cache: 'no-store', signal });
  if (response.status === 404 || response.status === 405) return null;
  const body = await response.json() as { success?: boolean; data?: { outcomes?: readonly ConversationOutcome[] }; error?: string };
  if (!response.ok || !body.success || !body.data) throw new Error(body.error || `Outcome read failed (${response.status})`);
  return body.data.outcomes?.[0];
}

/**
 * The notice for a message nobody answered: only outcomes with no chat reply by design
 * (`reply: 'no'`), with the code and reason so the run log and the trace can be matched.
 */
export function quietOutcomeNotice(outcome: ConversationOutcome | null | undefined, locale: ConsoleLocale = 'zh-CN'): string | null {
  if (!outcome || outcome.reply !== 'no') return null;
  const code = `${outcome.outcome}${outcome.reason ? ` · ${outcome.reason}` : ''}`;
  return locale === 'en' ? `${outcome.text} (${code})` : `${outcome.text}（${code}）`;
}

const FAILED_OUTCOMES: ReadonlySet<string> = new Set(['internal_error', 'delivery_failed', 'unrecorded', 'model_error', 'model_timeout']);

/**
 * #1250 `sandbox-submitted-without-feedback`: what to show next to a clicked card once the click's
 * outcome settled. A failure is an error; an outcome without a reply is a quiet notice; a reply
 * needs no notice. `undefined` (not settled yet) is decided by the caller after its last attempt.
 */
export function actionOutcomeFeedback(outcome: ConversationOutcome | null | undefined, locale: ConsoleLocale = 'zh-CN'):
  { readonly tone: 'error' | 'quiet'; readonly text: string } | null {
  if (!outcome) return null;
  const code = `${outcome.outcome}${outcome.reason ? ` · ${outcome.reason}` : ''}`;
  const text = locale === 'en' ? `${outcome.text} (${code})` : `${outcome.text}（${code}）`;
  if (FAILED_OUTCOMES.has(outcome.outcome)) return { tone: 'error', text };
  return outcome.reply === 'no' ? { tone: 'quiet', text } : null;
}
