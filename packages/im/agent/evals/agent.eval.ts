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
      // Real-model semantic checks (#723) must hold for the scripted answer too.
      const liveFailures = (definition.live?.checks(run) ?? []).filter((check) => !check.pass);
      if (liveFailures.length > 0) {
        throw new Error(`live checks fail on the scripted run of ${definition.id}:\n${liveFailures.map((c) => `- ${c.name}: ${c.detail ?? ''}`).join('\n')}`);
      }
    });
  }
});
