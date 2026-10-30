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
export class SessionToldLedger {
  readonly #sessions = new Map<string, ToldEntry[]>();
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
  record(sessionId: string, text: string, source: 'reply' | 'progress', turnId?: string): void {
    const extracted = extractToldEntries(text, source);
    if (extracted.length === 0) return;
    const current = [...(this.#sessions.get(sessionId) ?? [])];
    for (const entry of extracted) {
      const key = normalizeToldText(entry.text);
      const existing = current.findIndex((item) => normalizeToldText(item.text) === key);
      if (existing >= 0) current.splice(existing, 1);
      current.push(Object.freeze({ ...entry, ...(turnId ? { turnId } : {}), at: this.#now() }));
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
            ? { representedBy: deliveredReplyContextRef(sessionId, entry.turnId) } : {}),
        },
      };
    });
  }

  clear(sessionId?: string): void {
    if (sessionId === undefined) this.#sessions.clear();
    else this.#sessions.delete(sessionId);
  }

  #evict(): void {
    while (this.#sessions.size > this.#maxSessions) {
      const oldest = this.#sessions.keys().next().value;
      if (oldest === undefined) return;
      this.#sessions.delete(oldest);
    }
  }
}
