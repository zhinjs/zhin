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
 * acts, answers, or reports its plan. Any non-exploration tool resets it.
 */
export class ExplorationBudget {
  readonly #budget: number;
  #consecutive = 0;

  constructor(budget: number) {
    this.#budget = Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : 0;
  }

  record(toolName: string): string | undefined {
    if (this.#budget === 0) return undefined;
    if (!EXPLORATION_TOOLS.has(toolName)) {
      this.#consecutive = 0;
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
