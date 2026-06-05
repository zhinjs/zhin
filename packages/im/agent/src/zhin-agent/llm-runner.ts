import type { AIProvider, ChatMessage, ContentPart, Usage } from '@zhin.js/ai';
import { formatCompact, truncatePreview } from '@zhin.js/logger';
import type { ModelRegistry } from '@zhin.js/ai';
import { Logger } from '@zhin.js/core';
import type { OnChunkCallback, ZhinAgentConfig } from './config.js';
import { stripThinkBlocks } from './text-sanitize.js';
import { buildUserMessageWithHistory } from './prompt.js';
import { resolveModelCandidates, type ModelResolverConfig } from './model-resolver.js';
import { describeVisionPartsAsText, providerSupportsVision } from '../media/vision-capability.js';

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

/** 带图片等 vision parts 的闲聊路径 */
export async function streamChatWithVisionMedia(
  deps: LLMRunnerDeps,
  content: string,
  visionParts: ContentPart[],
  systemPrompt: string,
  history: ChatMessage[],
  onChunk?: OnChunkCallback,
  preferredModel?: string,
): Promise<StreamChatResult> {
  const { provider, modelRegistry, config } = deps;
  if (!providerSupportsVision(provider)) {
    const visionHint = describeVisionPartsAsText(visionParts);
    const merged = [content, visionHint].filter(Boolean).join('\n\n');
    return streamChatWithHistory(deps, merged, systemPrompt, history, onChunk, preferredModel);
  }
  const candidates = resolveModelCandidates(
    provider.models,
    modelRegistry,
    provider.name,
    config,
    'vision',
    preferredModel || config.visionModel,
  );
  const empty = (model: string): StreamChatResult => ({ content: '', usage: null, model });
  const turnTimeout = config.timeout;

  const userParts: ContentPart[] = [];
  if (history.length > 0) {
    const historyText = buildUserMessageWithHistory(history, '');
    if (historyText.trim()) userParts.push({ type: 'text', text: historyText });
  }
  if (content.trim()) userParts.push({ type: 'text', text: content });
  userParts.push(...visionParts);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userParts },
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
      if (result) return { content: result, usage: lastUsage, model };
      const response = await withTurnTimeout(provider.chat({ model, messages }));
      const msg = response.choices?.[0]?.message?.content;
      result = stripThinkBlocks(typeof msg === 'string' ? msg : contentToText(msg));
      if (result) return { content: result, usage: response.usage ?? null, model };
    } catch (err) {
      if (i === candidates.length - 1) return empty(model);
      logger.warn(formatCompact({
        fallback: `${model}→${candidates[i + 1]}`,
        error: truncatePreview((err as Error).message),
      }));
    }
  }
  return empty(candidates[0] || '');
}

function contentToText(c: string | ContentPart[] | null | undefined): string {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  return c.map(p => (p.type === 'text' ? p.text : `[${p.type}]`)).join(' ');
}