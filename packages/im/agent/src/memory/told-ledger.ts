/**
 * "Already told" ledger (#730, M2.5).
 *
 * Remembers, per session, the conclusions and commitments the agent has
 * already sent to the user, from final replies and from the progress updates
 * of #718 (one shared record). The next turn sees a short block of them so
 * the model neither repeats itself nor contradicts what it said, and
 * compaction keeps them in its summary.
 *
 * Extraction is rule-based on purpose (cheap and deterministic); a small
 * model can replace `extractToldEntries` later without touching callers.
 * The ledger lives in process memory; after a restart the persisted history
 * (and its compaction summary) still carries the same facts.
 */
import { createPromptContextBlock, type TextContentBlock } from '@zhin.js/ai';
import { deliveredReplyContextRef } from '../session/context-provenance.js';

export type ToldEntryKind = 'conclusion' | 'commitment' | 'progress';

export interface ToldEntry {
  readonly kind: ToldEntryKind;
  readonly text: string;
  readonly turnId?: string;
  /** Host-authored coverage identity; several answers can belong to the same real Turn. */
  readonly contextRef?: string;
  readonly at: number;
}

export interface ToldLedgerOptions {
  /** Entries kept per session (oldest dropped first). */
  readonly maxEntries?: number;
  /** Sessions kept in memory (least recently used dropped first). */
  readonly maxSessions?: number;
  readonly now?: () => number;
}

export const DEFAULT_TOLD_LEDGER_MAX_ENTRIES = 8;
export const DEFAULT_TOLD_LEDGER_MAX_SESSIONS = 5000;
/** Longest entry kept, in characters. */
export const TOLD_ENTRY_MAX_CHARS = 120;
export const TOLD_LEDGER_HEADING = '[Already told the user]';
/** Delivered-message references kept per session (#1250 own-reply-counts-as-background). */
export const DEFAULT_TOLD_LEDGER_MAX_DELIVERED = 64;
const DELIVERED_MESSAGE_REF_PREFIX = 'delivered-message:';

const SENTENCE_SPLIT = /(?<=[。！？!?；;])\s*|\n+|(?<=\.)\s+/u;
const COMMITMENT = /(我会|我将|稍后|之后会|回头|明天.*(提醒|告诉|发)|会在.*(提醒|通知|告诉)|已为你设置|I'll|I will|I'm going to|will remind)/iu;
/** Progress updates are sent with a leading `⏳ ` marker (see progress-reporter). */
const PROGRESS_PREFIX = /^⏳\s*/u;

/** Text normalised for de-duplication: case, whitespace and punctuation ignored. */
export function normalizeToldText(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= TOLD_ENTRY_MAX_CHARS ? line : `${line.slice(0, TOLD_ENTRY_MAX_CHARS - 1)}…`;
}

/**
 * Rules: a final reply contributes its lead sentence (replies lead with the
 * answer) as a conclusion and every sentence that promises future action as a
 * commitment. A progress update is recorded as one entry.
 */
export function extractToldEntries(text: string, source: 'reply' | 'progress'): Array<Pick<ToldEntry, 'kind' | 'text'>> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (source === 'progress') {
    const body = clip(trimmed.replace(PROGRESS_PREFIX, ''));
    return body ? [{ kind: 'progress', text: body }] : [];
  }
  const sentences = trimmed.split(SENTENCE_SPLIT).map(clip).filter((sentence) => normalizeToldText(sentence).length >= 2);
  if (sentences.length === 0) return [];
  const entries: Array<Pick<ToldEntry, 'kind' | 'text'>> = [];
  const [lead, ...rest] = sentences;
  entries.push({ kind: COMMITMENT.test(lead!) ? 'commitment' : 'conclusion', text: lead! });
  for (const sentence of rest) {
    if (COMMITMENT.test(sentence)) entries.push({ kind: 'commitment', text: sentence });
  }
  return entries;
}

/** Per-session ledger of what the user has already been told. */
/**
 * #1250 (ADR 0067 D8): the ledger id under which replies are recorded by Agent session key (runtime
 * fixed replies that have no session id yet). The `key:` namespace keeps a session key from ever
 * naming the same entry as a session id.
 */
export function sessionKeyLedgerId(sessionKey: string): string {
  return `key:${sessionKey}`;
}

/**
 * #1250 `scheduled-delivery-counts-as-background`: the ledger id under which this instance records the
 * deliveries of its own scheduled jobs whose run read no recorded content. `creatorId`: the chat user
 * who created the job (only that person's turns skip the message); absent: a job with no chat creator
 * (Console, CLI, Profile), skipped for every turn. The `scheduled:` namespace never names a session.
 */
export function scheduledDeliveryLedgerId(creatorId?: string): string {
  return creatorId === undefined ? 'scheduled:operator' : `scheduled:user:${JSON.stringify(creatorId)}`;
}

/**
 * #1250: whether `contextRef` names a clean delivery of this instance's own scheduled job that the
 * turn may treat as history: a job without a chat creator for any turn; a creator's job only for a
 * single-sender, human-started turn of that same creator.
 */
export function isOwnScheduledDelivery(
  ledger: Pick<SessionToldLedger, 'hasDelivered'> | undefined,
  turn: Readonly<{
    principal: Readonly<{ subjectId: string; origin?: string }>;
    input?: Readonly<{ mergedSenders?: readonly unknown[] }>;
  }>,
  contextRef: string,
): boolean {
  if (!ledger) return false;
  if (ledger.hasDelivered(scheduledDeliveryLedgerId(), contextRef)) return true;
  if (turn.principal.origin !== 'human' || turn.input?.mergedSenders?.length) return false;
  return ledger.hasDelivered(scheduledDeliveryLedgerId(turn.principal.subjectId), contextRef);
}

export class SessionToldLedger {
  readonly #sessions = new Map<string, ToldEntry[]>();
  /** `delivered-message:` references of replies this agent delivered with exact text evidence. */
  readonly #delivered = new Map<string, string[]>();
  readonly #maxEntries: number;
  readonly #maxSessions: number;
  readonly #now: () => number;

  constructor(options: ToldLedgerOptions = {}) {
    this.#maxEntries = options.maxEntries ?? DEFAULT_TOLD_LEDGER_MAX_ENTRIES;
    this.#maxSessions = options.maxSessions ?? DEFAULT_TOLD_LEDGER_MAX_SESSIONS;
    this.#now = options.now ?? Date.now;
    if (!Number.isInteger(this.#maxEntries) || this.#maxEntries < 1) {
      throw new TypeError('SessionToldLedger maxEntries must be a positive integer');
    }
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  entries(sessionId: string): readonly ToldEntry[] {
    return this.#sessions.get(sessionId) ?? [];
  }

  /** Records what was sent. A repeated statement moves to the newest position instead of duplicating. */
  record(sessionId: string, text: string, source: 'reply' | 'progress', turnId?: string, contextRef?: string): void {
    const extracted = extractToldEntries(text, source);
    if (extracted.length === 0) return;
    const current = [...(this.#sessions.get(sessionId) ?? [])];
    for (const entry of extracted) {
      const key = normalizeToldText(entry.text);
      const existing = current.findIndex((item) => normalizeToldText(item.text) === key);
      if (existing >= 0) current.splice(existing, 1);
      current.push(Object.freeze({ ...entry, ...(turnId ? { turnId } : {}), ...(contextRef ? { contextRef } : {}), at: this.#now() }));
    }
    this.#sessions.delete(sessionId);
    this.#sessions.set(sessionId, current.slice(-this.#maxEntries));
    this.#evict();
  }

  /** Short prompt block for the next turn, or undefined when nothing was told yet. */
  render(sessionId: string): string | undefined {
    const entries = this.entries(sessionId);
    if (entries.length === 0) return undefined;
    return [
      `${TOLD_LEDGER_HEADING} Do not repeat these unless asked; if something changed, say so explicitly instead of contradicting them.`,
      ...entries.map((entry) => `- (${entry.kind}) ${entry.text}`),
    ].join('\n');
  }

  /** Per-entry projection lets retained assistant history cover only the facts it still contains. */
  renderBlocks(sessionId: string): TextContentBlock[] {
    return this.entries(sessionId).map(entry => {
      const block = createPromptContextBlock('already-told',
        `${TOLD_LEDGER_HEADING} Do not repeat unless asked; say explicitly when something changed.\n- (${entry.kind}) ${entry.text}`);
      return {
        ...block,
        perTurn: true,
        contextRef: {
          ...block.contextRef!,
          ...(entry.turnId && entry.kind !== 'progress'
            ? { representedBy: entry.contextRef ?? deliveredReplyContextRef(sessionId, entry.turnId) } : {}),
        },
      };
    });
  }

  /**
   * #1250: remembers the platform messages this agent delivered as its reply in `sessionId`
   * (references from `deliveredReplyContextRefs`; only exact plain-text evidence produces one).
   * A later background block of the same message and text is the session history's own words,
   * not new content (ADR 0067 安全分析). The turn engine records only replies of turns that read no
   * recorded content (ADR 0067 D7, decision 5). Process memory only: after a restart such a block
   * counts as background again (fail closed).
   */
  recordDelivered(sessionId: string, contextRefs: readonly string[] | undefined): void {
    const refs = (contextRefs ?? []).filter(ref => ref.startsWith(DELIVERED_MESSAGE_REF_PREFIX));
    if (!refs.length) return;
    const current = (this.#delivered.get(sessionId) ?? []).filter(ref => !refs.includes(ref));
    current.push(...refs);
    this.#delivered.delete(sessionId);
    this.#delivered.set(sessionId, current.slice(-DEFAULT_TOLD_LEDGER_MAX_DELIVERED));
    this.#evict();
  }

  /** Whether `contextRef` names a message this agent delivered in `sessionId` (see {@link recordDelivered}). */
  hasDelivered(sessionId: string, contextRef: string): boolean {
    return this.#delivered.get(sessionId)?.includes(contextRef) ?? false;
  }

  clear(sessionId?: string): void {
    if (sessionId === undefined) {
      this.#sessions.clear();
      this.#delivered.clear();
    } else {
      this.#sessions.delete(sessionId);
      this.#delivered.delete(sessionId);
    }
  }

  #evict(): void {
    for (const map of [this.#sessions, this.#delivered] as const) {
      while (map.size > this.#maxSessions) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    }
  }
}
