/**
 * @zhin.js/core — AI 模块（仅基础类型与 Provider）
 *
 * Agent 循环、会话、ZhinAgent 等已迁至 @zhin.js/agent。
 */

// ── 类型定义 ──
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
  ContentPart,
  ToolCall,
  MessageRole,
  AgentTool,
  AgentConfig,
  AgentResult,
  Usage,
  ToolFilterOptions,
  SessionConfig,
  Session,
  ToolDefinition as ChatToolDefinition,
  JsonSchema,
} from './types.js';

// ── Providers ──
export {
  BaseProvider,
  OpenAIProvider,
  DeepSeekProvider,
  MoonshotProvider,
  ZhipuProvider,
  AnthropicProvider,
  OllamaProvider,
} from './providers/index.js';
export type {
  OpenAIConfig,
  AnthropicConfig,
  OllamaConfig,
} from './providers/index.js';
