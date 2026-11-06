import { AsyncLocalStorage } from 'node:async_hooks';
import type { UsageSubject } from '@zhin.js/core';
import type { UsageQuota } from './usage-quota.js';
import { estimatePromptTokens } from '../prompt/estimate-tokens.js';
import {
  ProviderAdmissionError,
  type InferenceUsageAccounting,
  type InferenceUsageOutcome,
  type InferenceUsageRequest,
} from '@zhin.js/ai/provider';

/** Thrown when the `onBehalfOf` user or group is over its usage quota; `message` is user-facing. Recognise it with `isAiCompletionQuotaError`. */
export class AiCompletionQuotaError extends ProviderAdmissionError {
  override readonly name = 'AiCompletionQuotaError' as const;
  readonly scope: 'user' | 'group';
  readonly retryAfterSeconds: number;
  readonly deniedUserIds?: readonly string[];

  constructor(message: string, scope: 'user' | 'group', retryAfterSeconds: number, deniedUserIds?: readonly string[]) {
    super(message);
    this.scope = scope;
    this.retryAfterSeconds = retryAfterSeconds;
    this.deniedUserIds = deniedUserIds;
  }
}

export interface UsageShare { readonly subject: UsageSubject; readonly weight: number }
export type UsageQuotaPort = Pick<UsageQuota, 'check' | 'checkTokens' | 'record'> & Partial<Pick<UsageQuota, 'checkBatch'>>;
export interface QuotaUsageTicket {
  submitted(): void;
  finish(outcome: InferenceUsageOutcome): void;
  close(): void;
}
export interface QuotaUsageOptions {
  readonly quota?: UsageQuotaPort;
  readonly shares: readonly UsageShare[];
  readonly alreadyAdmitted?: boolean;
  readonly shared?: boolean;
  readonly promptTokens: number;
  readonly onSettlementError?: (error: unknown) => void;
}
/** Existing admission, weighted allocation and monotone settlement, shared by both plugin APIs. */
export function beginQuotaUsage(options: QuotaUsageOptions): QuotaUsageTicket {
  const quota = options.quota, shares = options.shares;
  if (quota && shares.length) {
    if (options.shared && !quota.checkBatch) throw new Error('AI completion: quota does not support shared attribution');
    const check = options.alreadyAdmitted ? (subject: UsageSubject) => {
      if (!quota.checkTokens) throw new Error('Admitted inference requires token-only quota checking');
      return quota.checkTokens(subject);
    } : (subject: UsageSubject) => quota.check(subject);
    const decision = options.shared && !options.alreadyAdmitted ? quota.checkBatch!(shares.map(share => share.subject))
      : shares.map(share => check(share.subject)).find(value => !value.allowed) ?? { allowed: true as const };
    if (!decision.allowed) throw new AiCompletionQuotaError(decision.message, decision.scope, decision.retryAfterSeconds,
      'deniedUserIds' in decision ? decision.deniedUserIds as readonly string[] : undefined);
  }
  let submitted = false, finished = false, closed = false;
  let billed = shares.map(() => 0);
  function record(total: number) {
    if (!quota || !shares.length || total <= 0) return;
    const allocated = allocateTokens(total, shares.map(share => share.weight));
    shares.forEach((share, index) => quota.record(share.subject, allocated[index]! - billed[index]!));
    billed = allocated;
  }
  return {
    submitted() {
      if (submitted || closed) return;
      // Opening the model can await I/O. Recheck tokens at the actual submit boundary,
      // then reserve synchronously so another operation cannot pass in between.
      if (quota) for (const share of shares) {
        const decision = quota.checkTokens(share.subject);
        if (!decision.allowed) throw new AiCompletionQuotaError(decision.message, decision.scope, decision.retryAfterSeconds);
      }
      record(options.promptTokens); submitted = true;
    },
    finish(outcome) {
      if (!submitted || finished || closed) return;
      finished = true;
      const settled = outcome.totalTokens ?? options.promptTokens + estimatePromptTokens(outcome.text ?? '');
      // Preserve the existing no-refund reservation policy; estimates are not reported provider usage.
      try { record(Math.max(options.promptTokens, settled)); }
      catch (error) { try { options.onSettlementError?.(error); } catch { /* reporting cannot change inference */ } }
    },
    close() { closed = true; },
  };
}

function semanticPrompt(input: InferenceUsageRequest): string {
  if (input.kind === 'image') return input.request.prompt;
  if (input.kind === 'decision') return JSON.stringify({ state: input.state, questions: input.questions });
  const context = input.request.context;
  return JSON.stringify({ system: context.systemPrompt, messages: context.messages.map(message => {
    if (!Array.isArray(message.content)) return { role: message.role, content: message.content };
    return { role: message.role, content: message.content.map(block => {
      if (block.type === 'text') return block.text;
      if (block.type === 'thinking') return block.thinking;
      if (block.type === 'toolCall') return { name: block.name, arguments: block.arguments };
      return { type: block.type };
    }) };
  }), tools: context.tools?.map(tool => ({ name: tool.name, description: tool.description, schema: tool.inputJsonSchema })) });
}
export function createInferenceUsageAccounting(options: Readonly<{
  quota?: UsageQuotaPort; subject?: UsageSubject; alreadyAdmitted?: boolean;
  onSettlementError?: (error: unknown) => void;
}>): InferenceUsageAccounting {
  // One operation-owned async context, not a process-global current-account stack.
  const active = new AsyncLocalStorage<QuotaUsageTicket>();
  return Object.freeze({
    begin(input: InferenceUsageRequest) {
      const ticket = beginQuotaUsage({ quota: options.quota, shares: options.subject ? [{ subject: options.subject, weight: 1 }] : [],
        alreadyAdmitted: options.alreadyAdmitted, promptTokens: options.subject && options.quota ? estimatePromptTokens(semanticPrompt(input)) : 0,
        onSettlementError: options.onSettlementError });
      return { run: <T>(execute: () => Promise<T>) => active.run(ticket, execute), finish: ticket.finish, close: ticket.close };
    },
    submitted() { active.getStore()?.submitted(); },
  });
}

/** Highest-averages rounding is monotone: settling a larger total never needs to refund a user. */
function allocateTokens(tokens: number, weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const allocated = weights.map(weight => Math.floor(tokens * (weight / total)));
  let remaining = tokens - allocated.reduce((sum, value) => sum + value, 0);
  while (remaining > 0 && weights.length) {
    let next = 0;
    for (let index = 1; index < weights.length; index++) {
      if (weights[index]! / (allocated[index]! + 1) > weights[next]! / (allocated[next]! + 1)) next = index;
    }
    const amount = Math.min(1, remaining);
    allocated[next]! += amount; remaining -= amount;
  }
  return allocated;
}
