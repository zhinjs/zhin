/// <reference types="vite/client" />
/**
 * Nightly real-model eval entry (`pnpm eval:nightly`). Not part of the PR gate.
 *
 * Env:
 *   NIGHTLY_PROVIDER           gemini (default) | minimax (see providers.ts).
 *   GEMINI_API_KEY             required for gemini; the run is skipped when it is absent. Never logged.
 *   GEMINI_BASE_URL            optional Gemini API base URL override (proxy).
 *   NIGHTLY_THINKING_LEVEL     Gemini thinkingLevel (default: low; `off` sends none). Thinking
 *                              tokens count against the per-request output cap.
 *   MINIMAX_API_KEY            required for minimax; skipped when absent. Never logged.
 *   MINIMAX_BASE_URL           optional MiniMax base URL override.
 *   NIGHTLY_MODELS             comma-separated model ids (default: the provider's default,
 *                              DEFAULT_NIGHTLY_MODEL for gemini, minimax-m3 for minimax).
 *   NIGHTLY_RUNS_PER_CASE, NIGHTLY_MAX_REQUESTS, NIGHTLY_MAX_TOKENS,
 *   NIGHTLY_MAX_OUTPUT_TOKENS, NIGHTLY_REQUEST_TIMEOUT_MS   budget overrides (see budget.ts).
 *   NIGHTLY_MIN_REQUEST_INTERVAL_MS  spacing between real requests (default 4000 = 15 RPM,
 *                              the Gemini free tier; see rate-limit.ts).
 *   NIGHTLY_REPORT_DIR         output directory (default: eval-reports).
 *   NIGHTLY_PREVIOUS_REPORT    previous nightly.json to diff against (optional).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { createLlmApiRuntime, createLlmTransportModel } from '@zhin.js/ai';
import { BudgetedCompletionPort, resolveNightlyBudget } from './budget.js';
import { RateLimitedCompletionPort, resolveRateLimitPolicy } from './rate-limit.js';
import { CAPABILITY_MATRIX } from './matrix-cases.js';
import { resolveNightlyModels, resolveNightlyProvider } from './providers.js';
import { diffReports, renderMarkdown, type NightlyReport } from './report.js';
import { runNightlyMatrix } from './runner.js';
import { liveSeedCases } from './seed-cases.js';
import { loadEvalCases, type EvalCase } from '../framework/index.js';

export { DEFAULT_NIGHTLY_MODEL } from './providers.js';

const seedCases = liveSeedCases(loadEvalCases(import.meta.glob<{ default: EvalCase }>('../cases/*.case.ts', { eager: true })));

const env = process.env;
const provider = resolveNightlyProvider(env);

describe('nightly real-model evals', () => {
  it.skipIf(!provider.config.apiKey)(`capability matrix + seed cases on ${provider.id} (skipped without ${provider.keyEnv})`, async () => {
    const budget = resolveNightlyBudget(env);
    const modelIds = resolveNightlyModels(env, provider);
    const { config } = provider;
    const runtime = createLlmApiRuntime([{ alias: provider.id, config, models: modelIds, fetch: globalThis.fetch }], () => modelIds);
    // Every real request (matrix, seed-case turns, tool steps, retries) is paced and
    // serialized by the limiter; the budget counts each request it lets through.
    const policy = resolveRateLimitPolicy(env);
    const port = new RateLimitedCompletionPort(new BudgetedCompletionPort(runtime, budget), policy, {
      onEvent: (event) => {
        if (event.type === 'backoff') console.warn(`[nightly] 429 on ${event.model}: retry ${event.retry} in ${event.delayMs} ms`);
        if (event.type === 'give_up') console.warn(`[nightly] 429 on ${event.model}: gave up after ${event.retries} retries`);
        if (event.type === 'daily_quota') console.error(`[nightly] daily quota exhausted on ${event.model}; failing the run`);
      },
    });
    const report = await runNightlyMatrix({
      provider: provider.id,
      models: modelIds.map((id) => createLlmTransportModel(provider.id, config, id)),
      cases: CAPABILITY_MATRIX,
      seedCases,
      port,
      rateLimiter: port,
      budget,
      temperature: provider.temperature,
    });
    const previousPath = env.NIGHTLY_PREVIOUS_REPORT;
    const previous = previousPath && existsSync(previousPath)
      ? JSON.parse(await readFile(previousPath, 'utf8')) as NightlyReport
      : undefined;
    const diffs = diffReports(previous, report);
    const outDir = env.NIGHTLY_REPORT_DIR ?? 'eval-reports';
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'nightly.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(join(outDir, 'nightly-diff.json'), `${JSON.stringify(diffs, null, 2)}\n`);
    await writeFile(join(outDir, 'nightly.md'), `${renderMarkdown(report, diffs)}\n`);
    // Trend metric only: the run itself never fails on low pass rates. It does fail
    // when it could not run, so an exhausted daily quota never shows up green.
    if (report.fatal) throw new Error(report.fatal);
  }, 30 * 60_000);
});
