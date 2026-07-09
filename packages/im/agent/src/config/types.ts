import type { ProviderConfig, SdkId, OllamaProviderConfig } from '@zhin.js/ai';
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
  /** IM scene kind: private | group | channel */
  scene?: string;
  /** 群/频道 scene id（与 message.$channel.id 比对） */
  sceneId?: string;
  /** image | audio | video | text（纯文本无媒体 segment） */
  hasMedia?: string[];
  /** 子串匹配（不区分大小写） */
  contentContains?: string;
}

export type PermissionTaskAction = 'allow' | 'deny';

export interface AgentBindingConfig {
  provider: string;
  model: string;
  mcpServers?: string[];
  priority?: number;
  /** 单条或多条路由规则（ADR 0031 五 Bot 配置为数组） */
  match?: RouteMatchConfig | RouteMatchConfig[];
  /** Agent 昵称（LLM 自称 + IM 协作展示，ADR 0024 #11）。 */
  nickname?: string;
  /** spawn_task 可见子 agent 类型（glob → allow/deny，ADR 0030）。 */
  permission?: {
    task?: Record<string, PermissionTaskAction>;
  };
}

/** 解析后的 agent 绑定（运行时） */
export interface ResolvedAgentBinding {
  name: string;
  providerAlias: string;
  model: string;
  mcpServers: string[];
  /** 展示昵称（缺省回退 role label / agent 名）。 */
  nickname?: string;
  /** spawn_task 子 agent 类型过滤（ADR 0030）。 */
  permission?: AgentBindingConfig['permission'];
}

export const DEFAULT_ZHIN_AGENT_NAME = 'zhin';
