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
import { assistantText, createUserMessage, createResilientCompletionPort, resolveProviderResilienceConfig, type ProviderResilienceConfig, type TextCompleteResult } from '@zhin.js/ai';
import type { AiCompletion, AiCompletionInput, AiCompletionResult, UsageSubject } from '@zhin.js/core';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { AIService } from '../service.js';
import { renderExternalContent } from '../security/trust-level.js';
import { beginQuotaUsage, type UsageQuotaPort } from '../security/usage-accounting.js';
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

export { AiCompletionQuotaError } from '../security/usage-accounting.js';

export interface AiCompletionOptions {
  readonly service: Pick<AIService, 'getBindingRegistry' | 'getAgentConfig'>;
  readonly usageQuota?: UsageQuotaPort;
  readonly now?: () => number;
  /** A default Host operation leases one complete runtime policy snapshot; explicit calls stay fixed. */
  readonly acquireDefaultModel: (signal?: AbortSignal, agentName?: string) => Promise<ModelExecutionScope>;
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
      if (input.model?.trim()) throw new Error('AI completion: select a configured Profile instead of overriding its native model');
      let model = '';
      let provider = '';

      input.signal?.throwIfAborted();
      const user = [
        prompt,
        ...(input.untrusted ?? []).map(item => renderExternalContent(sourceLabel(item.source), neutralizeBlockMarkers(String(item.text ?? '')))),
      ].join('\n\n');
      // Reserve the prompt estimate before the call: concurrent calls then see each other's
      // spend at `check`, and a call that fails after reaching the provider is still billed.
      const accounting = beginQuotaUsage({ quota: options.usageQuota, shares, shared: Boolean(input.usageShares),
        promptTokens: shares.length && options.usageQuota ? estimatePromptTokens(`${input.system ?? ''}\n${user}`) : 0,
        onSettlementError: () => { try { logger.warn('AI completion quota settlement failed'); } catch { /* diagnostic only */ } },
      });
      const started = now();
      let result: TextCompleteResult;
      let scope: ModelExecutionScope | undefined;
      try {
        scope = await options.acquireDefaultModel(input.signal, input.agent);
        model = scope.chat.model.id;
        provider = scope.chat.binding.account.id;
        accounting.submitted();
        const completion = createResilientCompletionPort(scope.chat.completion, {
          config: resolveProviderResilienceConfig(options.service.getAgentConfig()?.providerResilience as ProviderResilienceConfig | undefined,
            scope.chat.model.executionPolicy,
            { requestTimeoutMs: input.timeoutMs }),
        });
        const answer = await completion.complete(scope.chat.model,
          { systemPrompt: input.system ?? '', messages: [createUserMessage(user)], tools: [] },
          { temperature: input.temperature, maxTokens: input.maxTokens, signal: input.signal });
        const reported = answer.usage?.reported;
        const knownUsage = answer.usage && (!reported || Object.values(reported).some(Boolean));
        result = { text: assistantText(answer), model, ...(knownUsage ? { usage: answer.usage } : {}) };
      } catch (error) {
        accounting.close();
        try { logger.warn(formatCompact({
          op: 'ai_completion',
          purpose,
          provider,
          model,
          outcome: 'error',
          durationMs: now() - started,
          error: error instanceof Error ? error.message : String(error),
        })); } catch { /* Diagnostics do not replace the actual failure. */ }
        throw error;
      } finally {
        try { await scope?.release(); }
        catch { try { logger.warn('AI completion model lease cleanup failed'); } catch { /* Cleanup does not replace the primary outcome. */ } }
      }
      const durationMs = now() - started;
      const reportedTokens = result.usage?.totalTokens;
      const totalTokens = reportedTokens;
      accounting.finish({ ...(totalTokens !== undefined ? { totalTokens } : {}), text: result.text });
      accounting.close();
      try { logger.info(formatCompact({
        op: 'ai_completion',
        purpose,
        provider,
        model: result.model,
        outcome: 'ok',
        durationMs,
        ...(totalTokens ? { tokens: totalTokens } : {}),
        untrusted: input.untrusted?.length ?? 0,
      })); } catch { /* A completed inference remains successful when diagnostics fail. */ }
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
