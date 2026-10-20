/**
 * Compile-time checks (tsconfig.typecheck.json, #877): the core AI completion contract must stay
 * structurally identical to the agent / `@zhin.js/ai` types it replaced.
 */
import type { TokenUsage } from '@zhin.js/ai';
import type {
  AiCompletion as CoreAiCompletion,
  AiCompletionResult as CoreAiCompletionResult,
  AiCompletionTokenUsage,
  UsageSubject as CoreUsageSubject,
} from '@zhin.js/core';
import type { Token } from '@zhin.js/plugin-runtime';
import { aiCompletionToken, type AiCompletion, type AiCompletionResult, type UsageSubject } from '@zhin.js/agent';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

export type UsageMatchesAi = Assert<Equal<AiCompletionTokenUsage, TokenUsage>>;
export type ResultMatches = Assert<Equal<AiCompletionResult, CoreAiCompletionResult>>;
export type CompletionMatches = Assert<Equal<AiCompletion, CoreAiCompletion>>;
export type SubjectMatches = Assert<Equal<UsageSubject, CoreUsageSubject>>;
export const tokenFromAgent: Token<CoreAiCompletion> = aiCompletionToken;
