/// <reference types="vite/client" />
/**
 * PR-gate eval suite: every `cases/*.case.ts` runs once against the real
 * FullAgentTurnEngine with a scripted model. Run with `pnpm eval:agent`.
 *
 * Set `ZHIN_EVAL_CONTEXT_REPORT=<file>` to also write each case's pass/fail
 * and first-request context budget as JSON (used for before/after
 * comparisons of context changes, #729).
 */
import { writeFileSync } from 'node:fs';
import { afterAll, describe, it } from 'vitest';
import type { ContextBudgetReport } from '../src/trace/context-budget.js';
import { evaluateExpectations, formatEvalReport, loadEvalCases, runEvalCase, type EvalCase } from './framework/index.js';

const cases = loadEvalCases(import.meta.glob<{ default: EvalCase }>('./cases/*.case.ts', { eager: true }));
const contextReportFile = process.env.ZHIN_EVAL_CONTEXT_REPORT;
const contextReport: Array<{ id: string; passed: boolean; context_budget?: ContextBudgetReport }> = [];

describe('agent evals (scripted model)', () => {
  for (const definition of cases) {
    const test = definition.skip ? it.skip : it;
    const title = definition.skip ? `${definition.id} — SKIPPED: ${definition.skip}` : `${definition.id} — ${definition.description}`;
    test(title, async () => {
      const run = await runEvalCase(definition);
      const failures = evaluateExpectations(definition, run);
      contextReport.push({ id: definition.id, passed: failures.length === 0, context_budget: run.traces[0]?.context_budget });
      if (failures.length > 0) throw new Error(formatEvalReport(definition, run, failures));
      // Real-model semantic checks (#723) must hold for the scripted answer too.
      const liveFailures = (definition.live?.checks(run) ?? []).filter((check) => !check.pass);
      if (liveFailures.length > 0) {
        throw new Error(`live checks fail on the scripted run of ${definition.id}:\n${liveFailures.map((c) => `- ${c.name}: ${c.detail ?? ''}`).join('\n')}`);
      }
    });
  }

  afterAll(() => {
    if (!contextReportFile) return;
    const sorted = [...contextReport].sort((left, right) => left.id.localeCompare(right.id));
    writeFileSync(contextReportFile, `${JSON.stringify(sorted, null, 2)}\n`);
  });
});
