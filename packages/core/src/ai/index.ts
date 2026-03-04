/**
 * @zhin.js/core — AI 模块
 *
 * 类型定义和 Provider 实现已迁移至独立的 @zhin.js/ai 包，
 * 此文件通过 re-export 保持向后兼容。
 *
 * 注意：ToolDefinition 不在此 re-export，因为 core/types.ts 有自己的同名类型。
 * 使用 ChatToolDefinition 别名代替。
 */

export type {
  AIConfig,
  AIProvider,
  ProviderConfig,
  ProviderCapabilities,
  OllamaProviderConfig,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatCompletionChoice,
  ChatCompletionChunkChoice,
  ContentPart,
  ToolCall,
  MessageRole,
  AgentTool,
  AgentConfig,
  AgentResult,
  ToolFilterOptions,
  Usage,
  SessionConfig,
  Session,
  JsonSchema,
} from '@zhin.js/ai';

export type { ToolDefinition as ChatToolDefinition } from '@zhin.js/ai';

export {
  BaseProvider,
  OpenAIProvider,
  DeepSeekProvider,
  MoonshotProvider,
  ZhipuProvider,
  AnthropicProvider,
  OllamaProvider,
} from '@zhin.js/ai';

export type {
  OpenAIConfig,
  AnthropicConfig,
  OllamaConfig,
} from '@zhin.js/ai';
