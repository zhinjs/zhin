import { describe, expect, it } from 'vitest';
import type { TokenUsage } from '@zhin.js/ai';
import * as core from '@zhin.js/core';
import type { AiCompletionTokenUsage } from '@zhin.js/core';
import * as agent from '../../src/index.js';
import {
  AiCompletionQuotaError,
  aiCompletionToken,
  type AiCompletionResult,
  type UsageSubject,
} from '../../src/plugin-runtime/ai-completion.js';
import type { UsageSubject as QuotaUsageSubject } from '../../src/security/usage-quota.js';

/** Compile-time: core's usage type must stay structurally identical to @zhin.js/ai TokenUsage. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const usageMatchesAi: Equal<AiCompletionTokenUsage, TokenUsage> = true;
const resultUsageMatchesAi: Equal<NonNullable<AiCompletionResult['usage']>, TokenUsage> = true;
const subjectMatchesCore: Equal<UsageSubject, core.UsageSubject> = true;
const quotaSubjectMatchesCore: Equal<QuotaUsageSubject, core.UsageSubject> = true;

describe('agent re-exports the core AI completion contract (#877)', () => {
  it('provides the very same token object and id', () => {
    expect(aiCompletionToken).toBe(core.aiCompletionToken);
    expect(agent.aiCompletionToken).toBe(core.aiCompletionToken);
    expect(aiCompletionToken.id).toBe('zhin.agent.ai-completion');
  });

  it('keeps AiCompletionQuotaError recognisable from core', () => {
    const error = new AiCompletionQuotaError('over quota', 'group', 60);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AiCompletionQuotaError');
    expect(core.isAiCompletionQuotaError(error)).toBe(true);
  });

  it('type assertions hold', () => {
    expect([usageMatchesAi, resultUsageMatchesAi, subjectMatchesCore, quotaSubjectMatchesCore]).toEqual([true, true, true, true]);
  });
});
