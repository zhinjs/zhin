/// <reference types="vite/client" />
/**
 * Multi-message ingress evals (#725): every `ingress-cases/*.case.ts` feeds
 * timed messages through the IM admission protocol (TurnAdmissionGate) and
 * runs each admitted turn on the real engine with a scripted model.
 */
import { describe, expect, it } from 'vitest';
import { evaluateIngressExpectations, runIngressEvalCase, type IngressEvalCase } from './framework/index.js';

const modules = import.meta.glob<{ default: IngressEvalCase }>('./ingress-cases/*.case.ts', { eager: true });
const cases = Object.values(modules).map((module) => module.default);

describe('agent ingress evals (admission, scripted model)', () => {
  it('has cases', () => expect(cases.length).toBeGreaterThan(0));
  for (const definition of cases) {
    it(`${definition.id} — ${definition.description}`, async () => {
      const run = await runIngressEvalCase(definition);
      const failures = evaluateIngressExpectations(definition, run);
      if (failures.length > 0) {
        throw new Error(`ingress eval "${definition.id}" failed:\n  ${failures.join('\n  ')}\n  turns: ${JSON.stringify(run.turns.map(({ reply: _r, ...turn }) => turn))}`);
      }
    });
  }
});
