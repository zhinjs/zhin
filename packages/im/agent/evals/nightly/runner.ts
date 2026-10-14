/** Runs the capability matrix against real models under a hard budget. */
import { createUserMessage, type LlmCompletionPort, type Model } from '@zhin.js/ai';
import { BudgetExceededError, type BudgetedCompletionPort, type NightlyBudget } from './budget.js';
import type { CapabilityCase } from './matrix-cases.js';
import { summarizeCase, type CaseRunResult, type ModelSummary, type NightlyReport } from './report.js';
import { observe, type LlmJudge } from './semantic.js';

export interface NightlyRunInput {
  readonly provider: string;
  readonly models: readonly Model[];
  readonly cases: readonly CapabilityCase[];
  readonly port: BudgetedCompletionPort | (LlmCompletionPort & { usage(): { requests: number; totalTokens: number } });
  readonly budget: NightlyBudget;
  /** Optional judge; unused by the built-in matrix, which relies on deterministic semantic checks. */
  readonly judge?: LlmJudge;
  readonly now?: () => Date;
}

export async function runNightlyMatrix(input: NightlyRunInput): Promise<NightlyReport> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let stoppedByBudget = false;
  const models: ModelSummary[] = [];

  for (const model of input.models) {
    const cases = [];
    for (const definition of input.cases) {
      const results: CaseRunResult[] = [];
      for (let run = 0; run < input.budget.runsPerCase; run++) {
        if (stoppedByBudget) {
          results.push({ pass: false, checks: [], totalTokens: 0, toolCalls: 0, skipped: true, error: 'skipped: budget exhausted' });
          continue;
        }
        try {
          const message = await input.port.complete(model, {
            systemPrompt: definition.systemPrompt,
            messages: [createUserMessage(definition.user)],
            tools: definition.tools ? [...definition.tools] : undefined,
          }, { temperature: 0.2 });
          if (message.stopReason === 'error') throw new Error(message.errorMessage ?? 'provider error');
          const observation = observe(message);
          const checks = definition.checks(observation);
          results.push({ pass: checks.every((c) => c.pass), checks, totalTokens: observation.totalTokens, toolCalls: observation.toolCalls.length });
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            stoppedByBudget = true;
            results.push({ pass: false, checks: [], totalTokens: 0, toolCalls: 0, skipped: true, error: error.message });
            continue;
          }
          results.push({ pass: false, checks: [], totalTokens: 0, toolCalls: 0, error: `provider error: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` });
        }
      }
      cases.push(summarizeCase(definition.id, definition.capability, results));
    }
    models.push({ model: model.id, cases });
  }

  const usage = input.port.usage();
  return {
    version: 1,
    startedAt,
    finishedAt: now().toISOString(),
    provider: input.provider,
    budget: { requests: usage.requests, totalTokens: usage.totalTokens, maxRequests: input.budget.maxRequests, maxTotalTokens: input.budget.maxTotalTokens },
    stoppedByBudget,
    models,
  };
}
