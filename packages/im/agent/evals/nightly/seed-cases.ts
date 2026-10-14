/**
 * M0.2 seed cases on the real-model tier (#723). Each seed case that declares
 * `live` checks is replayed end to end through the same eval driver as the PR
 * gate, with {@link createLiveModel} in place of the scripted model, and graded
 * by those semantic checks instead of exact `expect` strings.
 */
import type { LlmCompletionPort, Model } from '@zhin.js/ai';
import { createLiveModel, runEvalCase, type EvalCase } from '../framework/index.js';
import type { CaseRunResult } from './report.js';

export interface NightlySeedCase {
  readonly id: string;
  /** Runs the case once against `model` through `port`. */
  run(model: Model, port: LlmCompletionPort & { usage(): { totalTokens: number } }): Promise<CaseRunResult>;
}

/** Seed cases eligible for the nightly tier: not skipped and with live checks. */
export function liveSeedCases(cases: readonly EvalCase[]): NightlySeedCase[] {
  return cases.filter((definition) => !definition.skip && definition.live).map((definition) => ({
    id: `seed-${definition.id}`,
    async run(model, port) {
      const tokensBefore = port.usage().totalTokens;
      const run = await runEvalCase(definition, { model: () => createLiveModel({ port, model }) });
      const checks = definition.live?.checks(run) ?? [];
      return {
        pass: checks.length > 0 && checks.every((check) => check.pass),
        checks,
        totalTokens: port.usage().totalTokens - tokensBefore,
        toolCalls: run.attemptedTools.length,
      };
    },
  }));
}
