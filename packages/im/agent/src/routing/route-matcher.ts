import type { Message } from '@zhin.js/core';
import { extractMediaParts } from '../init/message-media.js';
import type { AgentBindingConfig, RouteMatchConfig } from '../config/types.js';
import { DEFAULT_ZHIN_AGENT_NAME } from '../config/types.js';

export interface RouteMatchInput {
  message: Message<any>;
  contentText: string;
  discoveredAgentNames: Set<string>;
}

function mediaKindsFromMessage(message: Message<any>): Set<string> {
  const parts = extractMediaParts(message);
  const kinds = new Set<string>();
  for (const p of parts) {
    if (p.type === 'image_url') kinds.add('image');
    else if (p.type === 'audio') kinds.add('audio');
    else if (p.type === 'video_url') kinds.add('video');
  }
  if (kinds.size === 0) kinds.add('text');
  return kinds;
}

function matchRouteRule(match: RouteMatchConfig, input: RouteMatchInput): boolean {
  const { message, contentText } = input;
  if (match.adapter && message.$adapter !== match.adapter) return false;
  if (match.bot) {
    const bot = String(message.$bot ?? '');
    if (bot !== match.bot && bot !== String(match.bot)) return false;
  }
  if (match.scene) {
    const scene = message.$channel?.type || 'private';
    if (scene !== match.scene) return false;
  }
  if (match.hasMedia?.length) {
    const kinds = mediaKindsFromMessage(message);
    const wantTextOnly = match.hasMedia.length === 0
      || (match.hasMedia.length === 1 && match.hasMedia[0] === 'text');
    if (wantTextOnly) {
      if (!kinds.has('text') || kinds.size > 1) return false;
    } else {
      const ok = match.hasMedia.some(m => kinds.has(m));
      if (!ok) return false;
    }
  }
  if (match.contentContains) {
    const hay = contentText.toLowerCase();
    if (!hay.includes(match.contentContains.toLowerCase())) return false;
  }
  return true;
}

function agentHasRoute(binding: AgentBindingConfig): boolean {
  return binding.match != null && Object.keys(binding.match).length > 0;
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
    if (!binding.match || !matchRouteRule(binding.match, input)) continue;
    return agentName;
  }
  return DEFAULT_ZHIN_AGENT_NAME;
}
