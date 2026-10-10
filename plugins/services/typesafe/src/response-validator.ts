import type { DecisionQuestions, DecisionResult, JsonValue } from '@zhin.js/ai';

/** Never includes a remote body, credential, prompt or candidate label. */
export class TypeSafeDecisionError extends Error {
  constructor(readonly code: 'invalid-request' | 'invalid-response' | 'invalid-config' | 'disposed' | 'cancelled' | 'timeout' | 'request-failed', readonly status?: number) {
    super(`TypeSafe decision ${code}${status === undefined ? '' : ` (HTTP ${status})`}`);
    this.name = 'TypeSafeDecisionError';
  }
}
function fail(): never { throw new TypeSafeDecisionError('invalid-response'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
function fraction(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return fail();
  return value;
}
function tokenCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail();
  return value;
}
function distribution(value: unknown, keys: readonly string[]): Record<string, number> {
  const entries = object(value);
  exactKeys(entries, keys);
  const result = Object.fromEntries(keys.map(key => [key, fraction(entries[key])]));
  if (Math.abs(Object.values(result).reduce((sum, p) => sum + p, 0) - 1) > 0.01) fail();
  return result;
}
function sameJson(actual: unknown, expected: JsonValue): boolean {
  if (actual === expected) return true;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => sameJson(actual[index], value));
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    const record = actual as Record<string, unknown>;
    return Object.keys(record).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => Object.hasOwn(record, key) && sameJson(record[key], value));
  }
  return false;
}
/** Validate the SDK's unchecked JSON at the trust boundary, then return only known fields. */
export function validateDecisionResult<Q extends DecisionQuestions>(raw: unknown, questions: Q): DecisionResult<Q> {
  const result = object(raw);
  if (typeof result.model !== 'string' || !result.model.trim()) fail();
  const usage = object(result.usage);
  const inputTokens = tokenCount(usage.input_tokens);
  const outputTokens = tokenCount(usage.output_tokens);
  const source = object(result.answers);
  exactKeys(source, Object.keys(questions));
  const answers: Record<string, unknown> = Object.create(null);
  for (const [name, question] of Object.entries(questions)) {
    const answer = object(source[name]);
    if (answer.type !== question.type) fail();
    switch (question.type) {
      case 'noul':
        answers[name] = { type: 'noul', noul: fraction(answer.noul) };
        break;
      case 'choice': {
        const keys = Object.keys(question.criteria);
        if (typeof answer.choice !== 'string' || !Object.hasOwn(question.criteria, answer.choice)) fail();
        answers[name] = { type: 'choice', choice: answer.choice, confidence: fraction(answer.confidence), probabilities: distribution(answer.probabilities, keys) };
        break;
      }
      case 'score': {
        const keys = question.criteria.map((_, index) => String(index));
        const legend = object(answer.legend);
        exactKeys(legend, keys);
        if (keys.some((key, index) => !sameJson(legend[key], question.criteria[index]))) fail();
        if (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > question.criteria.length - 1) fail();
        answers[name] = { type: 'score', score: answer.score, confidence: fraction(answer.confidence), legend: Object.fromEntries(keys.map((key, index) => [key, question.criteria[index]])), probabilities: distribution(answer.probabilities, keys) };
        break;
      }
    }
  }
  return { model: result.model, usage: { inputTokens, outputTokens }, answers } as DecisionResult<Q>;
}
