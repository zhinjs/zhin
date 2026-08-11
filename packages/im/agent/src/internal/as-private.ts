/**
 * 将 ZhinAgent 门面实例收窄为 ideal 模块可用的 host 契约（仅包内使用）。
 * 门面类与 ZhinAgentPrivate 全量对齐，此处仅类型窄化，无强转。
 */
import type { ZhinAgent } from '../zhin-agent/index.js';
import type { ZhinAgentPrivate } from './agent-host.js';

export function asPrivate(agent: ZhinAgent): ZhinAgentPrivate {
  return agent;
}
