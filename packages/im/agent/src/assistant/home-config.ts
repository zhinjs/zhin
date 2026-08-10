/**
 * Assistant Home Domain 配置（仅 Home Assistant）
 */
import type { JobNotify } from './types.js';

export const DEFAULT_ALLOWED_SERVICE_DOMAINS = ['light', 'climate', 'scene', 'cover', 'script'] as const;
export const DEFAULT_DEBOUNCE_MS = 5000;

export interface HomePolicyConfig {
  /** 仅 master 可调用 home_*（默认 true） */
  requireMaster?: boolean;
  /** 写操作需 Owner 审批的 HA domain（默认 lock、alarm_control_panel） */
  confirmServices?: string[];
  /** home_call_service 允许的 domain 白名单（默认 light/climate/scene/cover/script） */
  allowedServiceDomains?: string[];
}

export interface AssistantHomeConfig {
  enabled?: boolean;
  /** HA REST 基址，如 http://homeassistant.local:8123 */
  restUrl?: string;
  /** HA 长期访问令牌 */
  restToken?: string;
  /** 可选：ai.mcpServers 中的名称（REST 为主，MCP 仅校验） */
  mcpServer?: string;
  /** 中文/友好名 → entity_id */
  aliases?: Record<string, string>;
  policy?: HomePolicyConfig;
  /** 要通过 HA WebSocket 订阅状态变化的设备别名列表 */
  watch?: string[];
  /** 同实体状态变化推送的防抖间隔（毫秒，默认 5000） */
  debounceMs?: number;
}

export const DEFAULT_HOME_POLICY: Required<Pick<HomePolicyConfig, 'confirmServices'>> = {
  confirmServices: ['lock', 'alarm_control_panel'],
};

export type ResolvedHomePolicyConfig = HomePolicyConfig & {
  requireMaster: boolean;
  confirmServices: string[];
  allowedServiceDomains: string[];
};

export type ResolvedAssistantHomeConfig = AssistantHomeConfig & {
  enabled: boolean;
  aliases: Record<string, string>;
  watch: string[];
  debounceMs: number;
  policy: ResolvedHomePolicyConfig;
};

export function resolveAssistantHomeConfig(raw?: AssistantHomeConfig): ResolvedAssistantHomeConfig {
  return {
    enabled: raw?.enabled === true,
    restUrl: raw?.restUrl,
    restToken: raw?.restToken,
    mcpServer: raw?.mcpServer,
    aliases: raw?.aliases ?? {},
    watch: raw?.watch ?? [],
    debounceMs: raw?.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    policy: {
      requireMaster: raw?.policy?.requireMaster !== false,
      confirmServices: raw?.policy?.confirmServices ?? DEFAULT_HOME_POLICY.confirmServices,
      allowedServiceDomains: raw?.policy?.allowedServiceDomains ?? [...DEFAULT_ALLOWED_SERVICE_DOMAINS],
    },
  };
}

export function isAssistantHomeActive(home?: AssistantHomeConfig): boolean {
  const cfg = resolveAssistantHomeConfig(home);
  return cfg.enabled && Boolean(cfg.restUrl && cfg.restToken);
}

/** 占位：Home notify 可指向 HA（M3 router ha 通道） */
export type HomeJobNotify = Extract<JobNotify, { channel: 'ha' }>;
