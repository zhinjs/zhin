import type { Message } from '@zhin.js/core';
import { normalizeMatchRules } from './match-rules.js';
import { type AgentBindingConfig, type RouteMatchConfig, DEFAULT_ZHIN_AGENT_NAME } from '../config/types.js';

export { normalizeMatchRules } from './match-rules.js';

export interface RouteMatchInput {
  message: Message;
  contentText: string;
  discoveredAgentNames: Set<string>;
  /** Resolved endpoint aliases (config.name, appid, platformUserId, …). */
  endpointIds?: string[];
}

function endpointMatchesRule(matchEndpoint: string | undefined, input: RouteMatchInput): boolean {
  if (!matchEndpoint) return true;
  const want = String(matchEndpoint);
  const candidates = new Set<string>([
    String(input.message.$endpoint ?? ''),
    ...(input.endpointIds ?? []),
  ]);
  for (const id of candidates) {
    if (id && (id === want || id === String(matchEndpoint))) return true;
  }
  return false;
}

export function matchRouteRule(match: RouteMatchConfig, input: RouteMatchInput): boolean {
  const { message, contentText } = input;
  if (match.adapter && message.$adapter !== match.adapter) return false;
  if (match.endpoint && !endpointMatchesRule(match.endpoint, input)) return false;
  if (match.scene) {
    const scene = message.$channel?.type || 'private';
    if (scene !== match.scene) return false;
  }
  if (match.sceneId) {
    const channelId = String(message.$channel?.id ?? '');
    if (channelId !== match.sceneId && channelId !== String(match.sceneId)) return false;
  }
  if (match.contentContains) {
    const hay = contentText.toLowerCase();
    if (!hay.includes(match.contentContains.toLowerCase())) return false;
  }
  return true;
}

function agentHasRoute(binding: AgentBindingConfig): boolean {
  return normalizeMatchRules(binding.match).length > 0;
}

/**
 * 按 agents.<name>.priority 降序匹配；无 match 的 agent 不参与；无 .agent.md 跳过；无命中 → zhin。
 */
export function resolveRoutedAgentName(
  agents: Record<string, AgentBindingConfig>,
  input: RouteMatchInput,
): string {
  const entries = Object.entries(agents)
    .filter(([name, binding]) => name !== DEFAULT_ZHIN_AGENT_NAME && agentHasRoute(binding))
    .sort((a, b) => (b[1].priority ?? 0) - (a[1].priority ?? 0));

  for (const [agentName, binding] of entries) {
    if (!input.discoveredAgentNames.has(agentName)) continue;
    const rules = normalizeMatchRules(binding.match);
    if (!rules.some((rule) => matchRouteRule(rule, input))) continue;
    return agentName;
  }
  return DEFAULT_ZHIN_AGENT_NAME;
}
