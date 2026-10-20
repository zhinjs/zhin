/** JSON data accepted by a decision engine; never contains executable capabilities. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ChoiceQuestion<C extends Readonly<Record<string, JsonValue>> = Readonly<Record<string, JsonValue>>> {
  readonly type: 'choice';
  readonly instructions?: JsonValue;
  readonly criteria: C;
}
export type ScoreCriteria = readonly [JsonValue, JsonValue, ...JsonValue[]];
export interface ScoreQuestion<C extends ScoreCriteria = ScoreCriteria> {
  readonly type: 'score';
  readonly instructions?: JsonValue;
  readonly criteria: C;
}
export interface NoulQuestion {
  readonly type: 'noul';
  readonly instructions?: JsonValue;
  readonly criteria?: { readonly true?: JsonValue; readonly false?: JsonValue } | null;
}
export type DecisionQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;
export type DecisionQuestions = Readonly<Record<string, DecisionQuestion>>;

export interface ChoiceAnswer<C extends Readonly<Record<string, JsonValue>> = Readonly<Record<string, JsonValue>>> {
  readonly type: 'choice';
  readonly choice: keyof C & string;
  readonly confidence: number;
  readonly probabilities: { readonly [K in keyof C]: number };
}
/** Expected rubric index, rather than a normalized relevance score. */
export interface ScoreAnswer {
  readonly type: 'score';
  readonly score: number;
  readonly confidence: number;
  readonly legend: Readonly<Record<string, JsonValue>>;
  readonly probabilities: Readonly<Record<string, number>>;
}
/** Probability of true. Noul does not report a separate confidence value. */
export interface NoulAnswer { readonly type: 'noul'; readonly noul: number }
export type DecisionAnswer<Q extends DecisionQuestion> = Q extends ChoiceQuestion<infer C>
  ? ChoiceAnswer<C> : Q extends ScoreQuestion ? ScoreAnswer : NoulAnswer;
export interface DecisionRequest<Q extends DecisionQuestions = DecisionQuestions> {
  readonly state: JsonValue;
  readonly questions: Q;
  readonly model?: string;
}
export interface DecisionResult<Q extends DecisionQuestions = DecisionQuestions> {
  readonly model: string;
  readonly answers: { readonly [K in keyof Q]: DecisionAnswer<Q[K]> };
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}
export interface DecisionOptions {
  readonly signal: AbortSignal;
  /** Total budget including network attempts, body consumption and retry delays. */
  readonly timeoutMs?: number;
}
export interface DecisionProvider {
  evaluate<const Q extends DecisionQuestions>(request: DecisionRequest<Q>, options: DecisionOptions): Promise<DecisionResult<Q>>;
}
