/** Runs the capability matrix against real models under a hard budget. */
import { createUserMessage, type LlmCompletionPort, type MediaContentBlock, type Model } from '@zhin.js/ai';
import { BudgetExceededError, type BudgetedCompletionPort, type NightlyBudget } from './budget.js';
import type { CapabilityCase } from './matrix-cases.js';
import { isProviderUnavailable } from './rate-limit.js';
import { infraHealth, summarizeCase, type CaseRunResult, type ModelSummary, type NightlyReport } from './report.js';
import type { NightlySeedCase } from './seed-cases.js';
import { observe, type LlmJudge } from './semantic.js';

export interface NightlyRunInput {
  readonly provider: string;
  readonly models: readonly Model[];
  readonly cases: readonly CapabilityCase[];
  /** M0.2 seed cases replayed through the eval driver (see seed-cases.ts); run after the matrix. */
  readonly seedCases?: readonly NightlySeedCase[];
  readonly port: BudgetedCompletionPort | (LlmCompletionPort & { usage(): { requests: number; totalTokens: number } });
  /**
   * The rate limiter in front of the real API (rate-limit.ts). Once it reports a
   * fatal error (daily quota exhausted), the rest of the run is not attempted and
   * the report carries `fatal`, which fails the nightly job.
   */
  readonly rateLimiter?: {
    fatalError(): Error | undefined;
    stats?(): { requests: number; retries: number; gaveUp: number; unavailable503?: number; unavailableRetries?: number; providerUnavailable?: number };
    readonly policy?: { readonly minIntervalMs: number };
  };
  readonly budget: NightlyBudget;
  /**
   * Sampling temperature for matrix requests. Omitted when undefined: Gemini 3.6+
   * ignores custom temperatures and warns about them (ai.google.dev troubleshooting).
   */
  readonly temperature?: number;
  /** Optional judge; unused by the built-in matrix, which relies on deterministic semantic checks. */
  readonly judge?: LlmJudge;
  readonly now?: () => Date;
}

export async function runNightlyMatrix(input: NightlyRunInput): Promise<NightlyReport> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let stoppedByBudget = false;
  const models: ModelSummary[] = [];
  const fatal = () => input.rateLimiter?.fatalError();
  const unavailableCount = () => input.rateLimiter?.stats?.().providerUnavailable ?? 0;
  const fatalResult = (): CaseRunResult => ({ pass: false, checks: [], totalTokens: 0, toolCalls: 0, error: `not run: ${fatal()?.message}` });

  for (const model of input.models) {
    const cases = [];
    for (const definition of input.cases) {
      const results: CaseRunResult[] = [];
      for (let run = 0; run < input.budget.runsPerCase; run++) {
        if (fatal()) {
          results.push(fatalResult());
          continue;
        }
        if (stoppedByBudget) {
          results.push({ pass: false, checks: [], totalTokens: 0, toolCalls: 0, skipped: true, error: 'skipped: budget exhausted' });
          continue;
        }
        if (definition.images?.length && !model.input.includes('image')) {
          results.push({ pass: false, checks: [], totalTokens: 0, toolCalls: 0, skipped: true, error: 'skipped: model has no image input' });
          continue;
        }
        try {
          const message = await input.port.complete(model, {
            systemPrompt: definition.systemPrompt,
            messages: [createUserMessage(definition.user, imageBlocks(definition))],
            tools: definition.tools ? [...definition.tools] : undefined,
          }, input.temperature !== undefined ? { temperature: input.temperature } : {});
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
          if (isProviderUnavailable(error)) {
            results.push({ pass: false, checks: [], totalTokens: 0, toolCalls: 0, unavailable: true, error: error.message });
            continue;
          }
          results.push({ pass: false, checks: [], totalTokens: 0, toolCalls: 0, error: `provider error: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` });
        }
      }
      cases.push(summarizeCase(definition.id, definition.capability, results));
    }
    for (const seed of input.seedCases ?? []) {
      const results: CaseRunResult[] = [];
      for (let run = 0; run < input.budget.runsPerCase; run++) {
        if (fatal()) {
          results.push(fatalResult());
          continue;
        }
        if (stoppedByBudget || budgetSpent(input)) {
          stoppedByBudget = true;
          results.push({ pass: false, checks: [], totalTokens: 0, toolCalls: 0, skipped: true, error: 'skipped: budget exhausted' });
          continue;
        }
        try {
          const unavailableBefore = unavailableCount();
          const result = await seed.run(model, input.port);
          // The harness turns provider errors into a failed turn, so check the limiter too.
          if (fatal()) {
            results.push({ ...result, pass: false, error: fatal()?.message });
          } else if (!result.pass && unavailableCount() > unavailableBefore) {
            // A turn hit 503 twice: the run failed because the provider was down, not the model.
            results.push({ ...result, pass: false, unavailable: true, error: 'provider-unavailable: 503 UNAVAILABLE after retry during this run' });
          } else if (!result.pass && budgetSpent(input)) {
            // The harness turns a budget stop mid-case into a failed turn; don't count that run.
            stoppedByBudget = true;
            results.push({ ...result, skipped: true, error: 'skipped: budget exhausted mid-case' });
          } else {
            results.push(result);
          }
        } catch (error) {
          if (isProviderUnavailable(error)) {
            results.push({ pass: false, checks: [], totalTokens: 0, toolCalls: 0, unavailable: true, error: error.message });
            continue;
          }
          if (error instanceof BudgetExceededError) stoppedByBudget = true;
          results.push({
            pass: false, checks: [], totalTokens: 0, toolCalls: 0,
            ...(error instanceof BudgetExceededError ? { skipped: true } : {}),
            error: `${error instanceof BudgetExceededError ? '' : 'harness error: '}${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
          });
        }
      }
      cases.push(summarizeCase(seed.id, 'seed-case', results));
    }
    models.push({ model: model.id, cases });
  }

  const usage = input.port.usage();
  const pacing = input.rateLimiter?.stats?.();
  const fatalError = fatal();
  return {
    version: 1,
    startedAt,
    finishedAt: now().toISOString(),
    provider: input.provider,
    budget: { requests: usage.requests, totalTokens: usage.totalTokens, maxRequests: input.budget.maxRequests, maxTotalTokens: input.budget.maxTotalTokens },
    stoppedByBudget,
    ...(fatalError ? { fatal: fatalError.message } : {}),
    ...(pacing ? { pacing: { minIntervalMs: input.rateLimiter?.policy?.minIntervalMs ?? 0, ...pacing } } : {}),
    infra: infraHealth(models),
    models,
  };
}

function budgetSpent(input: NightlyRunInput): boolean {
  const usage = input.port.usage();
  return usage.requests >= input.budget.maxRequests || usage.totalTokens >= input.budget.maxTotalTokens;
}

function imageBlocks(definition: CapabilityCase): MediaContentBlock[] | undefined {
  return definition.images?.map((image) => ({
    type: 'image',
    data: { media: { kind: 'base64', value: image.base64, mime_type: image.mimeType } },
  }));
}
