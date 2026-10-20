/**
 * Plain text completion for plugins (#804).
 *
 * Plugins that only need text (summarise a chat, classify a message, rewrite a
 * reply) should not borrow a whole Agent turn: that is slow, and the model gets
 * tools such as file access while it reads untrusted group chat. This port does
 * one completion with **no tools at all** — the request carries no tool
 * definitions, so nothing the model writes can be executed — and reuses the
 * provider resilience chain (retry, backoff, timeout, same-provider fallback).
 *
 * Untrusted text is rendered as `external_content` data blocks (#726), and a
 * call made on behalf of an IM user counts against that user's / group's usage
 * quota (#727).
 */
import type { AIProvider, ProviderResilienceConfig, TextCompleteResult } from '@zhin.js/ai';
import type { AiCompletion, AiCompletionInput, AiCompletionResult } from '@zhin.js/core';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { AIService } from '../service.js';
import { renderExternalContent } from '../security/trust-level.js';
import type { UsageQuota } from '../security/usage-quota.js';

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
  UsageSubject,
} from '@zhin.js/core';

const logger = getLogger('agent');

/** Thrown when the `onBehalfOf` user or group is over its usage quota; `message` is user-facing. Recognise it with `isAiCompletionQuotaError`. */
export class AiCompletionQuotaError extends Error {
  override readonly name = 'AiCompletionQuotaError' as const;
  readonly scope: 'user' | 'group';
  readonly retryAfterSeconds: number;

  constructor(message: string, scope: 'user' | 'group', retryAfterSeconds: number) {
    super(message);
    this.scope = scope;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface AiCompletionOptions {
  readonly service: Pick<AIService, 'getBindingRegistry' | 'getProvider' | 'getAgentConfig'>;
  readonly usageQuota?: Pick<UsageQuota, 'check' | 'record'>;
  readonly now?: () => number;
}

export function createAiCompletion(options: AiCompletionOptions): AiCompletion {
  const now = options.now ?? Date.now;
  return Object.freeze({
    async completeText(input: AiCompletionInput): Promise<AiCompletionResult> {
      const purpose = requiredText(input.purpose, 'purpose');
      const prompt = requiredText(input.prompt, 'prompt');
      const registry = options.service.getBindingRegistry();
      const binding = input.agent ? registry.getBinding(input.agent) : registry.requireZhinBinding();
      if (!binding) throw new Error(`AI completion: agent binding "${input.agent}" not found`);
      const provider: AIProvider = options.service.getProvider(binding.providerAlias);
      const model = input.model?.trim() || binding.model || provider.models[0] || '';

      if (input.onBehalfOf && options.usageQuota) {
        const decision = options.usageQuota.check(input.onBehalfOf);
        if (!decision.allowed) {
          throw new AiCompletionQuotaError(decision.message, decision.scope, decision.retryAfterSeconds);
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
        fallbackModels: provider.models.filter(id => id && id !== model),
        resilience: options.service.getAgentConfig()?.providerResilience as ProviderResilienceConfig | undefined,
      };
      const started = now();
      let result: TextCompleteResult;
      try {
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
      }
      const durationMs = now() - started;
      const totalTokens = result.usage?.totalTokens;
      if (input.onBehalfOf && options.usageQuota && totalTokens) {
        options.usageQuota.record(input.onBehalfOf, totalTokens);
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
