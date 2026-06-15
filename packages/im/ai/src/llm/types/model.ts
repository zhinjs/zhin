/** LLM Model descriptor (ADR 0009 D1 / ADR 0018 transport). */

import type { SdkId } from '../sdk-registry.js';

/** @deprecated Legacy api ids in persisted messages; new transport uses `ai-sdk`. */
export type ModelApi =
  | 'ai-sdk'
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
  sdk?: SdkId;
  baseUrl?: string;
  compat?: OpenAiCompatFlags;
  reasoning?: boolean;
  input: ModelInputModality[];
  contextWindow: number;
  maxTokens: number;
  cost?: ModelCostRates;
}

export interface ProviderInstanceConfig {
  sdk: SdkId;
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
  /** Explicit model allowlist (yaml); overrides sdk preset */
  models?: string[];
  /** Default / preferred model; prepended to models list when absent */
  defaultModel?: string;
  /** Context window override */
  contextWindow?: number;
  /** Inherited from ProviderConfig — image defaults */
  imageGeneration?: import('../../image-generation.js').ImageGenerationDefaults;
}
