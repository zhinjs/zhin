/// <reference types="vite/client" />
/**
 * PR-gate eval suite: every `cases/*.case.ts` runs once against the real
 * FullAgentTurnEngine with a scripted model. Run with `pnpm eval:agent`.
 */
import { describe, it } from 'vitest';
import { evaluateExpectations, formatEvalReport, loadEvalCases, runEvalCase, type EvalCase } from './framework/index.js';

const cases = loadEvalCases(import.meta.glob<{ default: EvalCase }>('./cases/*.case.ts', { eager: true }));

describe('agent evals (scripted model)', () => {
  for (const definition of cases) {
    const test = definition.skip ? it.skip : it;
    const title = definition.skip ? `${definition.id} — SKIPPED: ${definition.skip}` : `${definition.id} — ${definition.description}`;
    test(title, async () => {
      const run = await runEvalCase(definition);
      const failures = evaluateExpectations(definition, run);
      if (failures.length > 0) throw new Error(formatEvalReport(definition, run, failures));
    });
  }
});
