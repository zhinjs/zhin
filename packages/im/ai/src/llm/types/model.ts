/** LLM Model descriptor (ADR 0009 D1). */

export type ModelApi =
  | 'openai-completions'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'ollama-chat'
  | 'cloudflare-workers-ai'
  | string;

export type ModelInputModality = 'text' | 'image';

export interface ModelCostRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface OpenAiCompatFlags {
  supportsDeveloperRole?: boolean;
  supportsReasoningContent?: boolean;
  toolCallsInAssistant?: boolean;
}

export interface Model {
  id: string;
  name?: string;
  provider: string;
  api: ModelApi;
  baseUrl?: string;
  compat?: OpenAiCompatFlags;
  reasoning?: boolean;
  input: ModelInputModality[];
  contextWindow: number;
  maxTokens: number;
  cost?: ModelCostRates;
}

export interface ProviderInstanceConfig {
  api: ModelApi;
  apiKey?: string;
  authScheme?: string;
  baseUrl?: string;
  compat?: OpenAiCompatFlags;
  headers?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
  /** Cloudflare Workers AI */
  accountId?: string;
  /** Ollama */
  host?: string;
}
