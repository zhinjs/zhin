/**
 * openai-completions ApiProvider — bridges legacy OpenAIProvider.chat (ADR 0009).
 */

import { formatCompact, getLogger } from '@zhin.js/logger';
import type { AIProvider } from '../../types.js';
import { OpenAIProvider } from '../../providers/openai.js';
import { formatRedactedJson } from '../redact-request-body.js';
import {
  chatCompletionToAssistantMessage,
  contextToChatCompletionRequest,
} from '../convert/openai-bridge.js';
import {
  createAssistantMessageEventStream,
  type StreamFn,
} from '../api-registry.js';

const llmContextLogger = getLogger('LLM');

export function createOpenAiCompletionsStreamFn(
  getResolver: () => ((alias: string) => AIProvider | undefined) | undefined,
): StreamFn {
  return (model, context, options) => {
    return createAssistantMessageEventStream(async (push) => {
      const provider = getResolver()?.(model.provider);
      if (!provider || typeof provider.chat !== 'function') {
        throw new Error(`Provider ${model.provider} does not support chat()`);
      }

      const request = contextToChatCompletionRequest(model, context, {
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      });
      llmContextLogger.debug(formatCompact({
        op: 'context_request',
        provider: model.provider,
        model: model.id,
        api: model.api,
        messages: formatRedactedJson(request.messages),
        tools: request.tools?.length ?? 0,
      }));

      let response;
      try {
        response = await provider.chat(request);
      } catch (err) {
        if (provider instanceof OpenAIProvider) {
          throw err;
        }
        throw err;
      }

      const assistant = chatCompletionToAssistantMessage(response, model);
      const text = assistant.content.find((b) => b.type === 'text');
      if (text && text.type === 'text' && text.text) {
        push({ type: 'text_delta', text: text.text });
      }
      return assistant;
    });
  };
}

export const OPENAI_COMPAT_APIS = ['openai-completions'] as const;

export function driverToModelApi(driver: string): string {
  const d = driver.trim().toLowerCase();
  switch (d) {
    case 'openai':
    case 'deepseek':
    case 'moonshot':
    case 'zhipu':
      return 'openai-completions';
    case 'anthropic':
      return 'anthropic-messages';
    case 'google':
    case 'gemini':
      return 'google-generative-ai';
    case 'ollama':
      return 'ollama-chat';
    case 'cloudflare':
      return 'cloudflare-workers-ai';
    default:
      return 'openai-completions';
  }
}
