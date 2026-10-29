import { createHash } from 'node:crypto';
import { EXPLORATION_TOOLS } from './tool-calls-user-format.js';

/** Consecutive read-only exploration calls before the harness nudges the model. 0 disables. */
export const DEFAULT_EXPLORATION_BUDGET = 8;

/** Opt-in system prompt guidance (enabled per model via the model harness). */
export const EXPLORATION_GUIDANCE = [
  '## Exploration discipline',
  '- Before exploring broadly, decide which specific files or facts you need and scope every search to those paths.',
  '- Do not scan the whole workspace or dependency folders; prefer read_file on a known path over wide grep/glob.',
  '- For larger or ambiguous requests, briefly propose a plan to the user first instead of exploring at length.',
].join('\n');

/**
 * Counts consecutive read-only exploration tool calls in one Turn. When the
 * count reaches the budget (and every further multiple), it returns a harness
 * note to append to that tool result so the model stops wandering and either
 * acts, answers, or reports its plan. It resets on the Turn progress signal
 * (see turn-progress.ts); other non-exploration calls leave it unchanged.
 */
export class ExplorationBudget {
  readonly #budget: number;
  #consecutive = 0;

  constructor(budget: number) {
    this.#budget = Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : 0;
  }

  record(toolName: string, progressed = !EXPLORATION_TOOLS.has(toolName)): string | undefined {
    if (this.#budget === 0) return undefined;
    if (!EXPLORATION_TOOLS.has(toolName)) {
      if (progressed) this.#consecutive = 0;
      return undefined;
    }
    this.#consecutive += 1;
    if (this.#consecutive % this.#budget !== 0) return undefined;
    return `[Harness note] ${this.#consecutive} read-only exploration calls in a row without acting. `
      + 'Stop exploring broadly: answer with what you know, make the change, '
      + 'or tell the user your plan (target files and intended change). '
      + 'Only read a file if you specifically need it.';
  }
}

/** Consecutive same-family calls without new information before the one-time hint (ADR 0042 §7). */
export const SPIN_THRESHOLD = 3;

const TOOL_FAMILIES: Readonly<Record<string, string>> = {
  grep: 'search', glob: 'search', list_dir: 'search',
  read_file: 'read',
  web_fetch: 'web', web_search: 'web',
};

const EMPTY_RESULT = /^\s*$|^no (matches|results)\b|^未找到|^没有(找到|匹配)|^无(匹配|结果)/i;

export interface SpinHint {
  readonly family: string;
  readonly calls: number;
  readonly reason: 'identical_results' | 'no_matches' | 'repeated_read';
  readonly note: string;
}

interface SpinObservation {
  readonly family: string;
  readonly tool: string;
  readonly argsKey: string;
  readonly digest: string;
  readonly empty: boolean;
}

/**
 * Detects a turn going in circles: the same tool family called
 * {@link SPIN_THRESHOLD} times in a row with nothing new coming back (identical
 * result digests, searches that match nothing, the same file read again).
 * Returns one harness note per turn to append to that tool result; tools of a
 * different family break the streak.
 */
export class SpinDetector {
  #streak: SpinObservation[] = [];
  #hinted = false;

  record(tool: string, args: unknown, resultText: string): SpinHint | undefined {
    if (this.#hinted) return undefined;
    const family = TOOL_FAMILIES[tool] ?? tool;
    const observation: SpinObservation = {
      family,
      tool,
      argsKey: stableKey(args),
      digest: createHash('sha1').update(resultText).digest('hex'),
      empty: EMPTY_RESULT.test(resultText.trim()),
    };
    if (this.#streak.length > 0 && this.#streak[0]!.family !== family) this.#streak = [];
    this.#streak.push(observation);
    if (this.#streak.length > SPIN_THRESHOLD) this.#streak.shift();
    if (this.#streak.length < SPIN_THRESHOLD) return undefined;
    const reason = spinReason(this.#streak);
    if (!reason) return undefined;
    this.#hinted = true;
    return {
      family,
      calls: SPIN_THRESHOLD,
      reason,
      note: `[Harness note] ${SPIN_THRESHOLD} ${family} calls in a row returned nothing new. `
        + 'Change your approach (different tool or a narrower query) or answer with what you already have.',
    };
  }
}

function spinReason(streak: readonly SpinObservation[]): SpinHint['reason'] | undefined {
  if (streak.every((entry) => entry.empty)) return 'no_matches';
  if (streak.every((entry) => entry.digest === streak[0]!.digest)) return 'identical_results';
  if (streak[0]!.family === 'read' && streak.every((entry) => entry.tool === streak[0]!.tool && entry.argsKey === streak[0]!.argsKey)) {
    return 'repeated_read';
  }
  return undefined;
}

function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableKey(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** Appended to a tool result when exactly one model call remains in the iteration limit (ADR 0042 §7). */
export const LAST_ITERATION_NUDGE = '[Harness note] One step left: reply now with what you have found so far.';
