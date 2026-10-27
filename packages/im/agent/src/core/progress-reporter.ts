/**
 * Brief, human-friendly progress updates during long Turns so the chat does
 * not look frozen. Text comes from the model's own interim note or a cheap
 * tools-off summary, and falls back to a fixed line. Raw tool calls, results,
 * paths and code never pass the guard. Updates are throttled per Turn.
 */
import {
  assistantText,
  createUserMessage,
  type AgentMessage,
  type LlmCompletionPort,
  type Model,
} from '@zhin.js/ai';
import { looksLikeRawToolMarkup, stripHallucinatedToolCalls, stripThinkBlocks } from './text-sanitize.js';
import type { Locale } from '@zhin.js/plugin-runtime';
import { turnReplyMessages } from './turn-reply-messages.js';
import { REPLY_LANGUAGE_RULE } from '../prompt/rules/reply-language.js';

export type ProgressUpdateTrigger = 'progress' | 'extension' | 'continuation';

export const PROGRESS_UPDATE_PREFIX = '⏳ ';
export const PROGRESS_SUMMARY_TIMEOUT_MS = 8_000;
const MAX_PROGRESS_CHARS = 160;
/** Extensions are milestones, but still at most one update per this interval. */
const EXTENSION_MIN_INTERVAL_MS = 15_000;

export function fallbackProgressText(steps: number, locale?: Locale): string {
  return turnReplyMessages(locale, 'progress', { steps });
}

/** Returns natural-language progress text, or undefined if it looks like raw tool output. */
export function friendlyProgressText(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const text = stripHallucinatedToolCalls(stripThinkBlocks(raw)).replace(/\s+/g, ' ').trim();
  if (!text || looksLikeRawToolMarkup(text)) return undefined;
  if (/```|^[[{]|<\/?[a-z_]+[^>]*>/i.test(text)) return undefined;
  if (/(?:^|[\s(（"'`])(?:~?\/|\.{1,2}\/)[\w.-]+\/[\w./-]*/.test(text)) return undefined;
  if (/\b[a-z]+_[a-z_]+\s*\(|\b(?:exit code|stdout|stderr)\b/i.test(text)) return undefined;
  return text.length > MAX_PROGRESS_CHARS ? `${text.slice(0, MAX_PROGRESS_CHARS - 1)}…` : text;
}

export function buildProgressSummaryInstruction(locale?: Locale): string {
  return [
    '[System notice] Tools are disabled for this reply.',
    'Write a 1-2 sentence progress update for the user: what is done so far and what you will do next.',
    REPLY_LANGUAGE_RULE,
    ...(locale === undefined ? [] : [`Reply language fallback: ${locale}.`]),
    'Plain natural language only: no tool names, file paths, commands, code or raw output.',
  ].join('\n');
}

export interface ProgressSummaryInput {
  readonly locale?: Locale;
  readonly transport: LlmCompletionPort;
  readonly model: Model;
  readonly systemPrompt: string;
  readonly messages: readonly AgentMessage[];
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Cheap tools-off completion; undefined on any failure. */
export async function summarizeProgress(input: ProgressSummaryInput): Promise<string | undefined> {
  const timeout = AbortSignal.timeout(input.timeoutMs ?? PROGRESS_SUMMARY_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  try {
    const assistant = await input.transport.complete(
      input.model,
      {
        systemPrompt: input.systemPrompt,
        messages: [...input.messages, createUserMessage(buildProgressSummaryInstruction(input.locale))],
        tools: undefined,
      },
      { signal, sessionId: input.sessionId },
    );
    return assistant.errorMessage ? undefined : assistantText(assistant).trim() || undefined;
  } catch {
    return undefined;
  }
}

export interface ProgressReportContext {
  readonly steps: number;
  /** The model's own interim note (text sent alongside tool calls), if any. */
  readonly interimText?: string;
}

export interface TurnProgressReporterOptions {
  readonly locale?: Locale;
  readonly sink: (text: string) => Promise<void>;
  readonly minIntervalMs: number;
  readonly maxUpdates: number;
  readonly summarize: () => Promise<string | undefined>;
  readonly now?: () => number;
}

export class TurnProgressReporter {
  readonly #options: TurnProgressReporterOptions;
  readonly #now: () => number;
  readonly #reported: string[] = [];
  #last: number;
  #count = 0;

  constructor(options: TurnProgressReporterOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#last = this.#now();
  }

  /** Texts already sent to the user in this Turn. */
  get reported(): readonly string[] {
    return this.#reported;
  }

  due(trigger: ProgressUpdateTrigger): boolean {
    if (this.#count >= this.#options.maxUpdates) return false;
    if (trigger === 'continuation') return true;
    const interval = trigger === 'extension'
      ? Math.min(this.#options.minIntervalMs, EXTENSION_MIN_INTERVAL_MS)
      : this.#options.minIntervalMs;
    return this.#now() - this.#last >= interval;
  }

  async report(trigger: ProgressUpdateTrigger, context: ProgressReportContext): Promise<boolean> {
    if (!this.due(trigger)) return false;
    this.#last = this.#now();
    this.#count += 1;
    const interim = friendlyProgressText(context.interimText);
    const fresh = interim && !this.#reported.includes(interim) ? interim : undefined;
    const text = fresh
      ?? friendlyProgressText(await this.#options.summarize().catch(() => undefined))
      ?? fallbackProgressText(context.steps, this.#options.locale);
    try {
      await this.#options.sink(`${PROGRESS_UPDATE_PREFIX}${text}`);
      this.#reported.push(text);
      return true;
    } catch {
      return false;
    }
  }
}
