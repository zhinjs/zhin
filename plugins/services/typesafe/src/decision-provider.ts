import { TypeSafeClient, APIError, type Fetch, type Questions, type SystemOneRequest } from '@typesafe-ai/sdk';
import type { DecisionOptions, DecisionProvider, DecisionQuestions, DecisionRequest, DecisionResult, JsonValue } from '@zhin.js/ai';
import { TypeSafeDecisionError, validateDecisionResult } from './response-validator.js';

export interface TypeSafeDecisionConfig {
  readonly enabled?: boolean;
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  /** Total request budget, including SDK retries. */
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}
function positiveBudget(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new TypeSafeDecisionError('invalid-config');
  return value;
}
function validateJson(value: JsonValue, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeSafeDecisionError('invalid-request');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new TypeSafeDecisionError('invalid-request');
  ancestors.add(value);
  for (const entry of Object.values(value)) validateJson(entry, ancestors);
  ancestors.delete(value);
}
function entry(value: JsonValue | undefined): void {
  if (value === undefined) return;
  validateJson(value);
  // The native API accepts text, arrays, objects and null as entries.
  if (typeof value === 'boolean' || typeof value === 'number') throw new TypeSafeDecisionError('invalid-request');
}
function validateRequest(request: DecisionRequest): void {
  entry(request.state);
  if (request.model !== undefined && (typeof request.model !== 'string' || !request.model.trim())) throw new TypeSafeDecisionError('invalid-request');
  const questions = request.questions;
  if (!questions || typeof questions !== 'object' || Array.isArray(questions) || !Object.keys(questions).length) throw new TypeSafeDecisionError('invalid-request');
  for (const question of Object.values(questions)) {
    if (!question || typeof question !== 'object') throw new TypeSafeDecisionError('invalid-request');
    entry(question.instructions);
    if (question.type === 'choice') {
      if (!question.criteria || typeof question.criteria !== 'object' || Array.isArray(question.criteria) || Object.keys(question.criteria).length < 2) throw new TypeSafeDecisionError('invalid-request');
      Object.values(question.criteria).forEach(value => entry(value));
    } else if (question.type === 'score') {
      if (!Array.isArray(question.criteria) || question.criteria.length < 2) throw new TypeSafeDecisionError('invalid-request');
      question.criteria.forEach(value => entry(value));
    } else if (question.type === 'noul') {
      if (question.criteria != null) {
        if (typeof question.criteria !== 'object' || Array.isArray(question.criteria) || Object.keys(question.criteria).some(key => key !== 'true' && key !== 'false')) throw new TypeSafeDecisionError('invalid-request');
        entry(question.criteria.true);
        entry(question.criteria.false);
      }
    } else throw new TypeSafeDecisionError('invalid-request');
  }
}

/** Generation-owned client. SDK logs are disabled because prompts and error bodies are private. */
export class TypeSafeDecisionProvider implements DecisionProvider {
  readonly #client: TypeSafeClient;
  readonly #timeoutMs: number;
  readonly #disposed = new AbortController();

  constructor(config: TypeSafeDecisionConfig, transport: { fetch?: Fetch } = {}) {
    if (typeof config.apiKey !== 'string' || !config.apiKey.trim() || /\$\{[^}]+\}/.test(config.apiKey)) throw new TypeSafeDecisionError('invalid-config');
    this.#timeoutMs = positiveBudget(config.timeoutMs ?? 10_000);
    const maxRetries = config.maxRetries ?? 2;
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) throw new TypeSafeDecisionError('invalid-config');
    if (config.model !== undefined && (typeof config.model !== 'string' || !config.model.trim())) throw new TypeSafeDecisionError('invalid-config');
    if (config.baseUrl !== undefined) {
      try {
        const url = new URL(config.baseUrl);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
      } catch { throw new TypeSafeDecisionError('invalid-config'); }
    }
    try {
      this.#client = new TypeSafeClient({ apiKey: config.apiKey, defaultModel: config.model ?? 'jev-latest', baseURL: config.baseUrl ?? 'https://api.typesafe.ai', timeout: this.#timeoutMs, retry: { maxRetries }, logLevel: 'off', fetch: transport.fetch });
    } catch { throw new TypeSafeDecisionError('invalid-config'); }
  }

  async evaluate<const Q extends DecisionQuestions>(request: DecisionRequest<Q>, options: DecisionOptions): Promise<DecisionResult<Q>> {
    if (this.#disposed.signal.aborted) throw new TypeSafeDecisionError('disposed');
    if (options.signal.aborted) throw new TypeSafeDecisionError('cancelled');
    validateRequest(request);
    // Capture the exact validated wire data before any asynchronous work. Strip extra fields
    // rather than letting the SDK forward unrelated data from structural request variables.
    const snapshot = JSON.parse(JSON.stringify({
      state: request.state,
      model: request.model,
      questions: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => [name, {
        type: question.type, instructions: question.instructions, criteria: question.criteria,
      }])),
    })) as DecisionRequest<Q>;
    const timeoutMs = positiveBudget(options.timeoutMs ?? this.#timeoutMs);
    const controller = new AbortController();
    const signal = AbortSignal.any([options.signal, this.#disposed.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortError = (): TypeSafeDecisionError => new TypeSafeDecisionError(this.#disposed.signal.aborted ? 'disposed' : options.signal.aborted ? 'cancelled' : 'timeout');
    let onAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      // Readonly JSON types differ only in mutability from the SDK's wire contract.
      const pending = this.#client.systemOne(snapshot as unknown as SystemOneRequest<Questions>, { signal, timeout: timeoutMs });
      const raw = await Promise.race([pending, aborted]);
      if (signal.aborted) throw abortError();
      return validateDecisionResult(raw, snapshot.questions);
    } catch (error) {
      if (signal.aborted) throw abortError();
      if (error instanceof TypeSafeDecisionError) throw error;
      throw new TypeSafeDecisionError('request-failed', error instanceof APIError ? error.status : undefined);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  dispose(): void { this.#disposed.abort(); }
}
