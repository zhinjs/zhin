/**
 * Plain text completion for plugins (#804).
 *
 * Plugins that only need text (summarise a chat, classify a message, rewrite a
 * reply) should not borrow a whole Agent turn: that is slow, and the model gets
 * tools such as file access while it reads untrusted group chat. This port does
 * one completion with **no tools at all** — the request carries no tool
 * definitions, so nothing the model writes can be executed — and reuses the
 * provider resilience chain (retry, backoff, timeout). There is no automatic model
 * fallback: a plugin call must never silently fail over to a pricier model, and no
 * per-binding fallback list exists to opt in to.
 *
 * Untrusted text is rendered as `external_content` data blocks (#726), and a
 * call made on behalf of an IM user counts against that user's / group's usage
 * quota (#727).
 */
import type { ModelExecutionScope } from '../model-runtime/types.js';
import type { AIProvider, ProviderResilienceConfig, TextCompleteResult } from '@zhin.js/ai';
import type { AiCompletion, AiCompletionInput, AiCompletionResult, UsageSubject } from '@zhin.js/core';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { AIService } from '../service.js';
import { renderExternalContent } from '../security/trust-level.js';
import type { UsageQuota } from '../security/usage-quota.js';
import { estimatePromptTokens } from '../prompt/estimate-tokens.js';

/**
 * The contract (types and token) lives in `@zhin.js/core` (#877) so plugins can import it from the
 * `zhin.js` main entry without this package; re-exported here unchanged (same token object and id).
 */
export { aiCompletionToken } from '@zhin.js/core';
export type {
  AiCompletion,
  AiCompletionInput,
  AiCompletionResult,
  AiCompletionUntrustedInput,
  AiCompletionUsageShare,
  UsageSubject,
} from '@zhin.js/core';

const logger = getLogger('agent');

/** Thrown when the `onBehalfOf` user or group is over its usage quota; `message` is user-facing. Recognise it with `isAiCompletionQuotaError`. */
export class AiCompletionQuotaError extends Error {
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

export interface AiCompletionOptions {
  readonly service: Pick<AIService, 'getBindingRegistry' | 'getProvider' | 'getAgentConfig'>
    & Partial<Pick<AIService, 'getModelRegistry'>>;
  readonly usageQuota?: Pick<UsageQuota, 'check' | 'record'> & Partial<Pick<UsageQuota, 'checkBatch'>>;
  readonly now?: () => number;
  /** A default Host operation leases one complete runtime policy snapshot; explicit calls stay fixed. */
  readonly acquireDefaultModel?: (signal?: AbortSignal) => Promise<ModelExecutionScope>;
}

export function createAiCompletion(options: AiCompletionOptions): AiCompletion {
  const now = options.now ?? Date.now;
  return Object.freeze({
    ...(options.usageQuota && !options.usageQuota.checkBatch ? {} : { supportsUsageShares: true as const }),
    async completeText(input: AiCompletionInput): Promise<AiCompletionResult> {
      const purpose = requiredText(input.purpose, 'purpose');
      const prompt = requiredText(input.prompt, 'prompt');
      const shares = usageShares(input);
      const registry = options.service.getBindingRegistry();
      const binding = input.agent ? registry.getBinding(input.agent) : registry.requireZhinBinding();
      if (!binding) throw new Error(`AI completion: agent binding "${input.agent}" not found`);
      let provider: AIProvider = options.service.getProvider(binding.providerAlias);
      let model = input.model?.trim() || binding.model || provider.models[0] || '';

      input.signal?.throwIfAborted();
      if (shares.length && options.usageQuota) {
        if (input.usageShares && !options.usageQuota.checkBatch) throw new Error('AI completion: quota does not support shared attribution');
        const decision = input.usageShares
          ? options.usageQuota.checkBatch!(shares.map(share => share.subject))
          : options.usageQuota.check(shares[0]!.subject);
        if (!decision.allowed) {
          throw new AiCompletionQuotaError(decision.message, decision.scope, decision.retryAfterSeconds,
            'deniedUserIds' in decision ? decision.deniedUserIds as readonly string[] : undefined);
        }
      }

      const user = [
        prompt,
        ...(input.untrusted ?? []).map(item => renderExternalContent(sourceLabel(item.source), neutralizeBlockMarkers(String(item.text ?? '')))),
      ].join('\n\n');
      const opts = {
        model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
        resilience: options.service.getAgentConfig()?.providerResilience as ProviderResilienceConfig | undefined,
      };
      // Reserve the prompt estimate before the call: concurrent calls then see each other's
      // spend at `check`, and a call that fails after reaching the provider is still billed.
      const reserved = shares.length && options.usageQuota ? estimatePromptTokens(`${input.system ?? ''}\n${user}`) : 0;
      let billed = shares.map(() => 0);
      const record = (tokens: number) => {
        if (!options.usageQuota || tokens <= 0) return;
        const allocated = allocateTokens(tokens, shares.map(share => share.weight));
        shares.forEach((share, index) => {
          options.usageQuota!.record(share.subject, allocated[index]! - billed[index]!);
        });
        billed = allocated;
      };
      const started = now();
      let result: TextCompleteResult;
      let scope: ModelExecutionScope | undefined;
      try {
        if (!input.agent && !input.model?.trim() && options.acquireDefaultModel) {
          scope = await options.acquireDefaultModel(input.signal);
          provider = scope.chat.provider; model = scope.chat.invocation.model.model; opts.model = model;
        }
        record(reserved);
        result = provider.completeTextResult
          ? await provider.completeTextResult(input.system ?? '', user, opts)
          : { text: await provider.completeText(input.system ?? '', user, opts), model };
      } catch (error) {
        logger.warn(formatCompact({
          op: 'ai_completion',
          purpose,
          provider: binding.providerAlias,
          model,
          outcome: 'error',
          durationMs: now() - started,
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      } finally {
        try { await scope?.release(); }
        catch { try { logger.warn('AI completion model lease cleanup failed'); } catch { /* Cleanup does not replace the primary outcome. */ } }
      }
      const durationMs = now() - started;
      const reportedTokens = result.usage?.totalTokens;
      const totalTokens = reportedTokens || undefined;
      if (shares.length && options.usageQuota) {
        // Reported usage settles the reservation; without it, estimate the answer on top of the prompt.
        const settled = totalTokens ?? reserved + estimatePromptTokens(result.text);
        if (settled > reserved) record(settled);
      }
      logger.info(formatCompact({
        op: 'ai_completion',
        purpose,
        provider: binding.providerAlias,
        model: result.model,
        outcome: 'ok',
        durationMs,
        ...(totalTokens ? { tokens: totalTokens } : {}),
        untrusted: input.untrusted?.length ?? 0,
      }));
      return Object.freeze({
        text: result.text,
        model: result.model,
        durationMs,
        ...(result.usage ? { usage: result.usage } : {}),
      });
    },
  });
}

function usageShares(input: AiCompletionInput): readonly { subject: UsageSubject; weight: number }[] {
  if (!input.usageShares) return input.onBehalfOf ? [{ subject: { ...input.onBehalfOf }, weight: 1 }] : [];
  if (input.onBehalfOf || !input.usageShares.length) throw new TypeError('AI completion: choose nonempty usageShares or onBehalfOf');
  const shares = new Map<string, { subject: UsageSubject; weight: number }>();
  for (const { subject, text } of input.usageShares) {
    if (!subject.userId || typeof text !== 'string' || !text.trim()) throw new TypeError('AI completion: invalid usage share');
    const weight = Math.max(1, estimatePromptTokens(text));
    const key = JSON.stringify([subject.userId, subject.groupId]);
    const previous = shares.get(key);
    if (previous && previous.subject.owner !== subject.owner) throw new TypeError('AI completion: conflicting usage subjects');
    shares.set(key, { subject: { ...subject }, weight: weight + (previous?.weight ?? 0) });
  }
  if (!Number.isFinite([...shares.values()].reduce((sum, share) => sum + share.weight, 0))) throw new TypeError('AI completion: invalid total weight');
  return [...shares.values()];
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

function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`AI completion: ${name} is required`);
  return value;
}

/** Untrusted text must not be able to close its data block early and continue as instructions. */
function neutralizeBlockMarkers(text: string): string {
  return text.replace(/\[(\s*(?:end\s+)?external_content)/giu, '［$1');
}

/** Keeps the source label from closing the data block or injecting quotes. */
function sourceLabel(source: unknown): string {
  const text = String(source ?? '').replace(/[^\p{L}\p{N}_.:/-]+/gu, '-').slice(0, 64);
  return text || 'untrusted';
}
