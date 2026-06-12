import type { ProviderConfig } from '@zhin.js/ai';
import type { OllamaProviderConfig } from '@zhin.js/ai';

export type ProviderDriver =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'google'
  | 'gemini'
  | 'ollama'
  | 'cloudflare';

export interface ProviderInstanceConfig extends ProviderConfig {
  /** LLM protocol id (ADR 0009 D1), e.g. openai-completions */
  api: string;
}

export interface RouteMatchConfig {
  adapter?: string;
  endpoint?: string;
  scene?: string;
  /** image | audio | video | text（纯文本无媒体 segment） */
  hasMedia?: string[];
  /** 子串匹配（不区分大小写） */
  contentContains?: string;
}

export interface AgentBindingConfig {
  provider: string;
  model: string;
  mcpServers?: string[];
  priority?: number;
  match?: RouteMatchConfig;
}

/** @deprecated 仅用于归一化旧版 ai.routes */
export interface RouteEntryConfig {
  priority: number;
  match: RouteMatchConfig;
}

/** 解析后的 agent 绑定（运行时） */
export interface ResolvedAgentBinding {
  name: string;
  providerAlias: string;
  model: string;
  mcpServers: string[];
}

export const DEFAULT_ZHIN_AGENT_NAME = 'zhin';
