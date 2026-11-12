import { definePluginStore } from 'zhin.js';
import type { QuizService } from './quiz.js';
import { resolveAnswersConfig, type AnswersConfig } from './config.js';

/** Owner-scoped quiz state consumed by discovered commands and middleware. */
export const quizServiceStore = definePluginStore<QuizService>('zhin.answers.quiz', 'Pending quiz questions per conversation and sender');
export const quizServiceToken = quizServiceStore;

/** Effective configuration per message (ADR 0050 / 0055): global < adapter < endpoint < conversation. */
export interface AnswersConfigResolver {
  configFor(message: unknown): Readonly<Partial<AnswersConfig>>;
}
export const answersConfigStore = definePluginStore<AnswersConfigResolver>('zhin.answers.config', 'Layered answers configuration for one message');

/** Settings for one command call: the conversation's effective config when the resolver is provided, else the global view. */
export function answersSettingsFor(context: {
  readonly config?: Partial<AnswersConfig>;
  readonly input?: unknown;
  readonly has?: (token: typeof answersConfigStore) => boolean;
  readonly use: (token: typeof answersConfigStore) => AnswersConfigResolver;
}): AnswersConfig {
  const resolver = context.input !== undefined && context.has?.(answersConfigStore) ? context.use(answersConfigStore) : undefined;
  return resolveAnswersConfig({ ...(context.config ?? {}), ...(resolver?.configFor(context.input) ?? {}) });
}
