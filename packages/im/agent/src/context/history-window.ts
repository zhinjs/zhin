/**
 * ADR 0043 §2: the history sent to the model is bounded by a token budget instead of a message
 * count. The window is applied at the LLM boundary only (stored history and the compaction input
 * are untouched), measured on what the model really gets (after projection), and always starts at
 * a turn boundary so a tool call and its results, or a merged turn, never get split.
 */
import { estimateAgentMessagesTokens, lastTurnStart, projectPromptContext, type AgentMessage, type AIConfig } from '@zhin.js/ai';

export type HistoryScene = 'group' | 'private' | 'masterPrivate';
export type HistoryTokensConfig = NonNullable<NonNullable<AIConfig['context']>['historyTokens']>;
export interface ContextHistoryConfig {
  /** `ai.context.historyTokens` */
  tokens?: HistoryTokensConfig;
  /** `ai.context.maxRecentMessages`: upper bound on history messages (whichever limit is hit first). */
  maxMessages?: number | string;
}

export const DEFAULT_HISTORY_TOKENS: Readonly<Record<HistoryScene, number>> = {
  group: 8_000,
  private: 12_000,
  masterPrivate: 24_000,
};

/** When the budget is exceeded the start moves forward until this share of the budget is left over. */
export const HISTORY_WINDOW_FILL_AFTER_MOVE = 0.75;

/** `8000`, `"8000"`, `"8k"`; `0` turns the token bound off. Anything else is ignored. */
export function parseHistoryTokenCount(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : undefined;
  if (typeof raw !== 'string' || raw.length > 32) return undefined;
  // Strip whitespace first so the pattern below has no overlapping quantifiers (linear time).
  const match = /^(\d+(?:\.\d+)?)([kK])?$/.exec(raw.replace(/\s+/gu, ''));
  if (!match) return undefined;
  return Math.floor(Number(match[1]) * (match[2] ? 1000 : 1));
}

export function resolveHistoryTokens(config: HistoryTokensConfig | undefined | null, scene: HistoryScene): number {
  if (config === undefined || config === null) return DEFAULT_HISTORY_TOKENS[scene];
  if (typeof config === 'object') return parseHistoryTokenCount((config as Record<string, unknown>)[scene]) ?? DEFAULT_HISTORY_TOKENS[scene];
  return parseHistoryTokenCount(config) ?? DEFAULT_HISTORY_TOKENS[scene];
}

export function resolveHistoryMaxMessages(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number(raw) : raw;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Number.POSITIVE_INFINITY;
}

export function historySceneFromTurn(
  turn: { origin: { kind: string; scope?: string }; principal: { roles: readonly string[] } } | undefined,
): HistoryScene {
  const scope = turn?.origin.kind === 'im' ? turn.origin.scope : undefined;
  if (scope === 'group' || scope === 'channel') return 'group';
  return turn?.principal.roles.includes('master') === true && scope === 'private' ? 'masterPrivate' : 'private';
}

function isSummaryHead(message: AgentMessage | undefined): boolean {
  if (message?.role !== 'user' || !Array.isArray(message.content)) return false;
  const first = message.content[0];
  return first?.type === 'text' && typeof first.text === 'string' && first.text.startsWith('[Previous conversation summary]');
}

function anchorKey(message: AgentMessage): string {
  const m = message as { role: string; timestamp?: number; toolCallId?: string; messageId?: string };
  return `${m.role}:${m.timestamp ?? ''}:${m.messageId ?? m.toolCallId ?? ''}`;
}

const MAX_TRACKED_SESSIONS = 2000;

export interface HistoryWindowResult {
  /** Summary head (when present) + the kept history + the current turn. */
  readonly messages: AgentMessage[];
  /** Index (in the input) of the first kept history message. */
  readonly start: number;
  /** History messages left out of the window (they stay in storage and in compaction's input). */
  readonly dropped: number;
}

export interface HistoryWindowOptions {
  /** Token budget for history after projection; 0 = unbounded. */
  readonly budget: number;
  /** Upper bound on history messages. */
  readonly maxMessages: number;
  /** Where the current turn starts; default: the last turn of `messages`. Use `messages.length` for history-only input. */
  readonly currentStart?: number;
}

/**
 * Remembers where each session's window starts so the start only moves when the budget is exceeded
 * (cache-friendly: the prompt prefix stays byte-identical turn after turn). In memory and bounded;
 * after a restart the window is simply refilled from the newest message backwards.
 */
export class HistoryWindowTracker {
  readonly #anchors = new Map<string, string>();

  get size(): number { return this.#anchors.size; }

  select(sessionId: string, messages: AgentMessage[], options: HistoryWindowOptions): HistoryWindowResult {
    const pinned = isSummaryHead(messages[0]) ? 1 : 0;
    const current = Math.min(options.currentStart ?? lastTurnStart(messages), messages.length);
    if (current <= pinned) return { messages, start: pinned, dropped: 0 };

    const candidates: number[] = [pinned];
    for (let i = pinned + 1; i < current; i++) {
      if (messages[i]!.role === 'user' && messages[i - 1]!.role !== 'user') candidates.push(i);
    }
    candidates.push(current); // sentinel: nothing of the history survives

    const head = messages.slice(0, pinned);
    const tail = messages.slice(current);
    const project = (slice: AgentMessage[]): number => estimateAgentMessagesTokens(projectPromptContext(slice));
    const currentTokens = options.budget > 0 ? project(tail) : 0;
    const fits = (start: number, share: number): boolean => {
      if (current - start > options.maxMessages) return false;
      if (options.budget <= 0) return true;
      const total = project([...head, ...messages.slice(start, current), ...tail]);
      return Math.max(0, total - currentTokens) <= options.budget * share;
    };

    const previous = this.#anchors.get(sessionId);
    const anchorAt = previous === undefined ? -1 : candidates.findIndex(c => c < current && anchorKey(messages[c]!) === previous);
    let start: number;
    if (anchorAt >= 0 && fits(candidates[anchorAt]!, 1)) {
      start = candidates[anchorAt]!;
    } else {
      const from = anchorAt >= 0 ? anchorAt + 1 : 0;
      const pick = (share: number) => candidates.slice(from).find(c => c === current || fits(c, share));
      // Cold fill uses the whole budget; moving an existing window leaves headroom.
      start = (anchorAt >= 0 ? pick(HISTORY_WINDOW_FILL_AFTER_MOVE) : undefined) ?? pick(1) ?? current;
    }

    this.#remember(sessionId, start < current ? anchorKey(messages[start]!) : undefined);
    if (start === pinned) return { messages, start, dropped: 0 };
    return { messages: [...head, ...messages.slice(start)], start, dropped: start - pinned };
  }

  #remember(sessionId: string, key: string | undefined): void {
    this.#anchors.delete(sessionId);
    if (key === undefined) return;
    this.#anchors.set(sessionId, key);
    while (this.#anchors.size > MAX_TRACKED_SESSIONS) {
      const oldest = this.#anchors.keys().next().value;
      if (oldest === undefined) break;
      this.#anchors.delete(oldest);
    }
  }

  clear(): void { this.#anchors.clear(); }
}

const trackers = new WeakMap<object, HistoryWindowTracker>();

/** One tracker per Agent host, so window starts survive across turns of a session. */
export function historyWindowTrackerFor(host: object): HistoryWindowTracker {
  let tracker = trackers.get(host);
  if (!tracker) {
    tracker = new HistoryWindowTracker();
    trackers.set(host, tracker);
  }
  return tracker;
}
