/**
 * 将 ZhinAgent 门面实例收窄为 ideal 模块可用的 host 契约（仅包内使用）。
 */
import type { AIProvider } from '@zhin.js/ai';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { ZhinAgentPrivate } from './agent-host.js';

export function asPrivate(agent: {
  getTurnProvider(): AIProvider;
  getActiveBinding(): ResolvedAgentBinding | null;
}): ZhinAgentPrivate {
  return agent as unknown as ZhinAgentPrivate;
}
