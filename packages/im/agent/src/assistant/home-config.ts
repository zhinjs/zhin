/**
 * Assistant Home Domain 配置（M4）
 */
import type { JobNotify } from './types.js';

export interface HomePolicyConfig {
  /** 仅 master 可调用 home_*（默认 true） */
  requireMaster?: boolean;
  /** 写操作需 Owner 审批的 HA domain（默认 lock、alarm_control_panel） */
  confirmServices?: string[];
}

export interface AssistantHomeConfig {
  enabled?: boolean;
  /** HA REST 基址，如 http://homeassistant.local:8123 */
  restUrl?: string;
  /** HA 长期访问令牌 */
  restToken?: string;
  /** 可选：ai.mcpServers 中的名称（M4 以 REST 为主，MCP 后续扩展） */
  mcpServer?: string;
  /** 中文/友好名 → entity_id */
  aliases?: Record<string, string>;
  policy?: HomePolicyConfig;
}

export const DEFAULT_HOME_POLICY: Required<Pick<HomePolicyConfig, 'confirmServices'>> = {
  confirmServices: ['lock', 'alarm_control_panel'],
};

export function resolveAssistantHomeConfig(
  raw?: AssistantHomeConfig,
): AssistantHomeConfig & { enabled: boolean; policy: HomePolicyConfig & { requireMaster: boolean; confirmServices: string[] } } {
  return {
    enabled: raw?.enabled === true,
    restUrl: raw?.restUrl,
    restToken: raw?.restToken,
    mcpServer: raw?.mcpServer,
    aliases: raw?.aliases ?? {},
    policy: {
      requireMaster: raw?.policy?.requireMaster !== false,
      confirmServices: raw?.policy?.confirmServices ?? DEFAULT_HOME_POLICY.confirmServices,
    },
  };
}

export function isAssistantHomeActive(home?: AssistantHomeConfig): boolean {
  const cfg = resolveAssistantHomeConfig(home);
  return cfg.enabled && Boolean(cfg.restUrl && cfg.restToken);
}

/** 占位：Home notify 可指向 HA（M3 router ha 通道） */
export type HomeJobNotify = Extract<JobNotify, { channel: 'ha' }>;
