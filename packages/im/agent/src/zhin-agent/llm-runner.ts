import type { AIProvider, ChatMessage, Usage } from '@zhin.js/ai';
import { formatCompact, truncatePreview } from '@zhin.js/logger';
import type { ModelRegistry } from '@zhin.js/ai';
import { Logger } from '@zhin.js/core';
import type { OnChunkCallback, ZhinAgentConfig } from './config.js';
import { stripThinkBlocks } from './text-sanitize.js';
import { buildUserMessageWithHistory } from './prompt.js';
import { resolveModelCandidates, type ModelResolverConfig } from './model-resolver.js';

const logger = new Logger(null, 'ZhinAgent');

export interface StreamChatResult {
  content: string;
  usage: Usage | null;
  model: string;
}

export interface LLMRunnerDeps {
  provider: AIProvider;
  modelRegistry: ModelRegistry | null;
  config: Required<ZhinAgentConfig> & ModelResolverConfig;
}

export async function streamChatWithHistory(
  deps: LLMRunnerDeps,
  content: string,
  systemPrompt: string,
  history: ChatMessage[],
  onChunk?: OnChunkCallback,
  preferredModel?: string,
): Promise<StreamChatResult> {
  const { provider, modelRegistry, config } = deps;
  const candidates = resolveModelCandidates(provider.models, modelRegistry, provider.name, config, 'chat', preferredModel);
  const empty = (model: string): StreamChatResult => ({ content: '', usage: null, model });
  const turnTimeout = config.timeout;
  const userContent = history.length > 0
    ? buildUserMessageWithHistory(history, content)
    : content;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  const withTurnTimeout = <T>(promise: Promise<T>): Promise<T> =>
    turnTimeout
      ? Promise.race([
          promise,
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error(`LLM 单轮响应超时 (${turnTimeout}ms)`)), turnTimeout),
          ),
        ])
      : promise;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      let result = '';
      let lastUsage: Usage | null = null;
      await withTurnTimeout((async () => {
        for await (const chunk of provider.chatStream({ model, messages })) {
          if (chunk.usage) lastUsage = chunk.usage;
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          const text = typeof delta.content === 'string' ? delta.content : '';
          if (text) {
            result += text;
            if (onChunk) onChunk(text, result);
          }
        }
      })());
      result = stripThinkBlocks(result);
      if (result) {
        return { content: result, usage: lastUsage, model };
      }
      logger.warn(formatCompact( { stream: 'empty', model }));
      const response = await withTurnTimeout(provider.chat({ model, messages }));
      const msg = response.choices?.[0]?.message?.content;
      result = stripThinkBlocks(typeof msg === 'string' ? msg : '');
      if (result) {
        if (onChunk) onChunk(result, result);
        return { content: result, usage: response.usage ?? null, model };
      }
    } catch (err) {
      const isLast = i === candidates.length - 1;
      if (isLast) {
        try {
          const response = await withTurnTimeout(provider.chat({ model, messages }));
          const msg = response.choices?.[0]?.message?.content;
          let result = stripThinkBlocks(typeof msg === 'string' ? msg : '');
          if (onChunk && result) onChunk(result, result);
          if (result) {
            return { content: result, usage: response.usage ?? null, model };
          }
          return empty(model);
        } catch {
          return empty(model);
        }
      }
      logger.warn(formatCompact( {
        fallback: `${model}→${candidates[i + 1]}`,
        error: truncatePreview((err as Error).message),
      }));
    }
  }
  return empty(candidates[0] || '');
}