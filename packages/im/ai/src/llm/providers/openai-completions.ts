/**
 * openai-completions ApiProvider — bridges legacy AIProvider.chat (ADR 0009).
 *
 * 生产传输已全部走 ai-sdk（registerLlmApiFromProviders / getLlmTransportModel
 * 恒产 api='ai-sdk' 的 Model）；本桥现存唯一用途是 agent 测试 mock
 * （tests/helpers/mock-llm-api.ts 把 mock provider.chat 桥成 llm stream）。
 */

import { formatCompact, getLogger } from '@zhin.js/logger';
import type { AIProvider } from '../../types.js';
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

      const response = await provider.chat(request);

      const assistant = chatCompletionToAssistantMessage(response, model);
      const text = assistant.content.find((b) => b.type === 'text');
      if (text && text.type === 'text' && text.text) {
        push({ type: 'text_delta', text: text.text });
      }
      return assistant;
    });
  };
}
