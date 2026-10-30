/**
 * Progress-aware tool budget for one agent Turn.
 *
 * The configured `maxIterations` is a soft budget. When the loop reaches it,
 * the Turn gets `extendBy` more steps only if it made progress in the recent
 * window and is not looping or failing, up to `maxTotalIterations`. Wall-clock
 * and token caps stop the loop at any point. When a Turn stops while the model
 * still wants tools and progress was made, it may auto-continue from a
 * tools-off summary inside the same Turn (same policy, ports and history).
 */
import type { TurnContextView } from '../context/turn-envelope.js';
import { createHash } from 'node:crypto';
import { classifyBashCommand } from '../security/file-policy.js';
import { EXPLORATION_TOOLS } from './tool-calls-user-format.js';

export type ToolBudgetAutoContinue = 'off' | 'master_dm' | 'on';
export type ToolBudgetProgressUpdates = 'off' | 'private' | 'all';

export interface ToolBudgetSettings {
  /** Steps granted per extension when the Turn is progressing. 0 disables extensions. */
  readonly extendBy: number;
  /** Progress must have happened within this many recent steps to extend. */
  readonly progressWindow: number;
  /** Hard cap on steps per Turn segment (base + extensions). */
  readonly maxTotalIterations: number;
  /** Hard cap on steps for one in-turn sub-agent. */
  readonly maxSubagentTotalIterations: number;
  /** Wall-clock cap for the whole Turn, including continuations. 0 disables. */
  readonly maxWallClockMs: number;
  /** Token cap (sum of model usage) for the whole Turn. 0 disables. */
  readonly maxTotalTokens: number;
  /** Consecutive failed tool calls that count as stalled. */
  readonly failureStreakLimit: number;
  /** Consecutive repeated identical calls that count as looping. */
  readonly repeatLimit: number;
  /** When to auto-continue a progressing Turn that hit its budget. */
  readonly autoContinue: ToolBudgetAutoContinue;
  /** Maximum auto-continuations per Turn. */
  readonly maxContinuations: number;
  /** Progress updates to the chat during long Turns: off, private chats only, or all chats. */
  readonly progressUpdates: ToolBudgetProgressUpdates;
  /** Minimum time between progress updates. */
  readonly progressMinIntervalMs: number;
  /** Maximum progress updates per Turn. */
  readonly progressMaxUpdates: number;
}

export const DEFAULT_TOOL_BUDGET: ToolBudgetSettings = Object.freeze({
  extendBy: 10,
  progressWindow: 5,
  maxTotalIterations: 40,
  maxSubagentTotalIterations: 30,
  maxWallClockMs: 10 * 60_000,
  maxTotalTokens: 0,
  failureStreakLimit: 3,
  repeatLimit: 2,
  autoContinue: 'master_dm',
  maxContinuations: 2,
  progressUpdates: 'private',
  progressMinIntervalMs: 45_000,
  progressMaxUpdates: 3,
});

export interface ToolBudgetHarnessOverride {
  readonly iterationExtension?: number;
  readonly maxTotalIterations?: number;
}

const AUTO_CONTINUE = new Set<ToolBudgetAutoContinue>(['off', 'master_dm', 'on']);
const PROGRESS_UPDATES = new Set<ToolBudgetProgressUpdates>(['off', 'private', 'all']);

/** Group chats get progress updates only when opted in with `all`. */
export function progressUpdatesAllowed(mode: ToolBudgetProgressUpdates, turn: TurnContextView | undefined): boolean {
  if (mode === 'all') return true;
  if (mode !== 'private' || !turn) return false;
  return turn.origin.kind !== 'im' || turn.origin.scope === 'private';
}

/** Merges defaults, `ai.agent.toolBudget` and the per-model harness, ignoring invalid values. */
export function resolveToolBudget(
  config?: Partial<Record<keyof ToolBudgetSettings, unknown>>,
  harness: ToolBudgetHarnessOverride = {},
): ToolBudgetSettings {
  const count = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  const pick = (key: Exclude<keyof ToolBudgetSettings, 'autoContinue' | 'progressUpdates'>) =>
    count(config?.[key], DEFAULT_TOOL_BUDGET[key]);
  const autoContinue = config?.autoContinue;
  return Object.freeze({
    extendBy: count(harness.iterationExtension, pick('extendBy')),
    progressWindow: Math.max(1, pick('progressWindow')),
    maxTotalIterations: count(harness.maxTotalIterations, pick('maxTotalIterations')),
    maxSubagentTotalIterations: pick('maxSubagentTotalIterations'),
    maxWallClockMs: pick('maxWallClockMs'),
    maxTotalTokens: pick('maxTotalTokens'),
    failureStreakLimit: Math.max(1, pick('failureStreakLimit')),
    repeatLimit: Math.max(1, pick('repeatLimit')),
    autoContinue: AUTO_CONTINUE.has(autoContinue as ToolBudgetAutoContinue)
      ? autoContinue as ToolBudgetAutoContinue
      : DEFAULT_TOOL_BUDGET.autoContinue,
    maxContinuations: pick('maxContinuations'),
    progressUpdates: PROGRESS_UPDATES.has(config?.progressUpdates as ToolBudgetProgressUpdates)
      ? config?.progressUpdates as ToolBudgetProgressUpdates
      : DEFAULT_TOOL_BUDGET.progressUpdates,
    progressMinIntervalMs: pick('progressMinIntervalMs'),
    progressMaxUpdates: pick('progressMaxUpdates'),
  });
}

/** Auto-continuation only reuses the current Turn, so it never widens authority. */
export function autoContinueAllowed(mode: ToolBudgetAutoContinue, turn: TurnContextView | undefined): boolean {
  if (mode === 'on') return true;
  if (mode !== 'master_dm' || !turn) return false;
  return turn.principal.roles.includes('master')
    && turn.origin.kind === 'im'
    && turn.origin.scope === 'private';
}

export type ToolProgressKind =
  | 'mutation'
  | 'subagent'
  | 'new_result'
  | 'exploration'
  | 'repeat'
  | 'failure';

export interface ToolProgressRecord {
  readonly toolName: string;
  readonly args: unknown;
  readonly ok: boolean;
  readonly output?: string;
}

const MUTATING_TOOLS = new Set(['write_file', 'edit_file', 'multi_edit', 'apply_patch']);
const MUTATING_NAME = /(?:^|_)(?:create|schedule|add|update|delete|remove|send|set|write|edit|move|rename|commit)(?:_|$)/;

export function isProgress(kind: ToolProgressKind): boolean {
  return kind === 'mutation' || kind === 'subagent' || kind === 'new_result';
}

/** Classifies tool calls in one Turn into progress and non-progress events. */
export class TurnProgressTracker {
  readonly #signatures = new Set<string>();
  readonly #settings: ToolBudgetSettings;
  readonly #observeResults: boolean;
  #lastProgressIteration = -1;
  #failureStreak = 0;
  #repeatStreak = 0;
  #segmentProgress = 0;

  constructor(settings: ToolBudgetSettings, observeResults = false) {
    this.#settings = settings;
    this.#observeResults = observeResults;
  }

  record(iteration: number, call: ToolProgressRecord): ToolProgressKind {
    const kind = this.#classify(call);
    if (kind === 'failure') this.#failureStreak += 1;
    else this.#failureStreak = 0;
    if (kind === 'repeat') this.#repeatStreak += 1;
    else if (kind !== 'failure') this.#repeatStreak = 0;
    if (isProgress(kind)) {
      this.#lastProgressIteration = iteration;
      this.#segmentProgress += 1;
    }
    return kind;
  }

  /** Looping on identical calls or failing repeatedly. */
  get stalled(): boolean {
    return this.#failureStreak >= this.#settings.failureStreakLimit
      || this.#repeatStreak >= this.#settings.repeatLimit;
  }

  /** Progress happened at or after the given (1-based) iteration. */
  progressedSince(iteration: number): boolean {
    return this.#lastProgressIteration > 0 && this.#lastProgressIteration >= iteration;
  }

  startSegment(): void {
    this.#segmentProgress = 0;
  }

  get segmentProgressed(): boolean {
    return this.#segmentProgress > 0;
  }

  #classify(call: ToolProgressRecord): ToolProgressKind {
    if (!call.ok) return 'failure';
    const command = (call.args as { command?: unknown } | undefined)?.command;
    const mutating = MUTATING_TOOLS.has(call.toolName) || MUTATING_NAME.test(call.toolName)
      || (call.toolName === 'bash' && typeof command === 'string' && !classifyBashCommand(command).isReadOnly);
    // A fresh read of a changing result is useful; repeated writes are still repeated side effects.
    const resultKey = this.#observeResults && !mutating
      ? createHash('sha256').update(call.output ?? '').digest('hex') : '';
    const signature = `${call.toolName}:${stableStringify(call.args)}:${resultKey}`;
    if (this.#signatures.has(signature)) return 'repeat';
    this.#signatures.add(signature);
    if (call.toolName === 'spawn_task') {
      return call.output?.includes('已完成') ? 'subagent' : 'exploration';
    }
    if (call.toolName === 'bash') {
      const command = (call.args as { command?: unknown } | undefined)?.command;
      return typeof command === 'string' && !classifyBashCommand(command).isReadOnly
        ? 'mutation'
        : 'exploration';
    }
    if (EXPLORATION_TOOLS.has(call.toolName)) return 'exploration';
    if (MUTATING_TOOLS.has(call.toolName) || MUTATING_NAME.test(call.toolName)) return 'mutation';
    return 'new_result';
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

/** Instruction that resumes a Turn after an automatic continuation checkpoint. */
export function buildContinuationInstruction(index: number, max: number, reported: readonly string[] = []): string {
  return [
    `[System notice] Automatic continuation ${index}/${max}: the previous step budget ran out while the task was progressing.`,
    'Continue the same task from your summary above with the same tools and permissions.',
    'Do not repeat finished work. When the task is done, reply to the user with the result.',
    ...(reported.length
      ? ['Progress updates already sent to the user (do not repeat them):', ...reported.map(text => `- ${text}`)]
      : []),
  ].join('\n');
}
