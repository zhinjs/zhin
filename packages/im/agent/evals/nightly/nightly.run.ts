/// <reference types="vite/client" />
/**
 * Nightly real-model eval entry (`pnpm eval:nightly`). Not part of the PR gate.
 *
 * Env:
 *   MINIMAX_API_KEY            required; the run is skipped when it is absent. Never logged.
 *   MINIMAX_BASE_URL           optional provider base URL override.
 *   NIGHTLY_MODELS             comma-separated model ids (default: minimax-m3).
 *   NIGHTLY_RUNS_PER_CASE, NIGHTLY_MAX_REQUESTS, NIGHTLY_MAX_TOKENS,
 *   NIGHTLY_MAX_OUTPUT_TOKENS, NIGHTLY_REQUEST_TIMEOUT_MS   budget overrides (see budget.ts).
 *   NIGHTLY_REPORT_DIR         output directory (default: eval-reports).
 *   NIGHTLY_PREVIOUS_REPORT    previous nightly.json to diff against (optional).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { createLlmApiRuntime, createLlmTransportModel, type ProviderInstanceConfig } from '@zhin.js/ai';
import { BudgetedCompletionPort, resolveNightlyBudget } from './budget.js';
import { CAPABILITY_MATRIX } from './matrix-cases.js';
import { diffReports, renderMarkdown, type NightlyReport } from './report.js';
import { runNightlyMatrix } from './runner.js';
import { liveSeedCases } from './seed-cases.js';
import { loadEvalCases, type EvalCase } from '../framework/index.js';

const seedCases = liveSeedCases(loadEvalCases(import.meta.glob<{ default: EvalCase }>('../cases/*.case.ts', { eager: true })));

const PROVIDER = 'minimax';
const env = process.env;
const apiKey = env.MINIMAX_API_KEY?.trim();

describe('nightly real-model evals', () => {
  it.skipIf(!apiKey)('capability matrix + seed cases (skipped without MINIMAX_API_KEY)', async () => {
    const budget = resolveNightlyBudget(env);
    const modelIds = (env.NIGHTLY_MODELS ?? 'minimax-m3').split(',').map((id) => id.trim()).filter(Boolean);
    const config: ProviderInstanceConfig = {
      sdk: 'minimax',
      apiKey,
      ...(env.MINIMAX_BASE_URL ? { baseUrl: env.MINIMAX_BASE_URL } : {}),
      maxRetries: 1,
    };
    const runtime = createLlmApiRuntime([{ alias: PROVIDER, config, models: modelIds, fetch: globalThis.fetch }], () => modelIds);
    const port = new BudgetedCompletionPort(runtime, budget);
    const report = await runNightlyMatrix({
      provider: PROVIDER,
      models: modelIds.map((id) => createLlmTransportModel(PROVIDER, config, id)),
      cases: CAPABILITY_MATRIX,
      seedCases,
      port,
      budget,
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
    // Trend metric only: the run itself never fails on low pass rates.
  }, 30 * 60_000);
});
