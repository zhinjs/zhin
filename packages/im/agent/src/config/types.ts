import type { VenueDefinition } from '@zhin.js/core';
import type { AgentStartupConfig } from './agent-startup.js';

export type VenueConfig = VenueDefinition;
export type AIConfig = AgentStartupConfig;

/**
 * @deprecated Inbound routing by `match` never took effect (IM inbound always
 * uses the `zhin` binding). Accepted with a warning; removed in the next minor.
 */
export interface RouteMatchConfig {
  adapter?: string;
  endpoint?: string;
  /** IM scene kind: private | group | channel */
  scene?: string;
  /** 群/频道 scene id（与 message.conversation.id 比对） */
  sceneId?: string;
  /** image | audio | video | text（纯文本无媒体 segment） */
  hasMedia?: string[];
  /** 子串匹配（不区分大小写） */
  contentContains?: string;
}

export interface AgentBindingConfig {
  mcpServers?: readonly string[];
  /**
   * @deprecated Never took effect; accepted with a warning and removed by
   * `zhin config check --fix`. Dropped from the effective config.
   */
  priority?: number;
  /**
   * @deprecated Never took effect (including `hasMedia`); accepted with a
   * warning and removed by `zhin config check --fix`. Dropped from the
   * effective config.
   */
  match?: RouteMatchConfig | RouteMatchConfig[];
  /** 任务/协作角色昵称（ADR 0024 #11）；IM 自我资料优先取当前 Endpoint，此值仅作最终显示名兜底。 */
  nickname?: string;
}

/** 解析后的 agent 绑定（运行时） */
export interface ResolvedAgentBinding {
  name: string;
  mcpServers: readonly string[];
  /** 任务/协作角色显示名；IM 当前账号昵称由 Endpoint 资料提供，此值仅作最终兜底。 */
  nickname?: string;
}

export const DEFAULT_ZHIN_AGENT_NAME = 'zhin';
