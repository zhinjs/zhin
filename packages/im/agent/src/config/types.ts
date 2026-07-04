import type { ProviderConfig } from '@zhin.js/ai';
import type { SdkId } from '@zhin.js/ai';
import type { OllamaProviderConfig } from '@zhin.js/ai';

export type { SdkId };

export interface ProviderInstanceConfig extends ProviderConfig, OllamaProviderConfig {
  /** AI SDK provider id (ADR 0018 closed table) */
  sdk: SdkId;
  /** Cloudflare Workers AI */
  accountId?: string;
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
  /** Agent 昵称（LLM 自称 + IM 协作展示，ADR 0024 #11）。 */
  nickname?: string;
}

/** 解析后的 agent 绑定（运行时） */
export interface ResolvedAgentBinding {
  name: string;
  providerAlias: string;
  model: string;
  mcpServers: string[];
  /** 展示昵称（缺省回退 role label / agent 名）。 */
  nickname?: string;
}

export const DEFAULT_ZHIN_AGENT_NAME = 'zhin';
