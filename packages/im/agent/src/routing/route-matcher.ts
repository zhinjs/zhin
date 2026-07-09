import type { Message } from '@zhin.js/core';
import { extractMediaParts } from '../init/message-media.js';
import { type AgentBindingConfig, type RouteMatchConfig, DEFAULT_ZHIN_AGENT_NAME } from '../config/types.js';
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

type RawMatchRule = RouteMatchConfig & { kind?: string };

function mediaKindsFromMessage(message: Message): Set<string> {
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

/** Normalize YAML match (object or ADR 0031 array) into route rules. */
export function normalizeMatchRules(match: AgentBindingConfig['match']): RouteMatchConfig[] {
  if (match == null) return [];
  if (Array.isArray(match)) {
    return match.flatMap((item) => normalizeMatchRules(item as AgentBindingConfig['match']));
  }
  if (typeof match !== 'object') return [];

  const raw = match as RawMatchRule;
  const scene = raw.scene
    ?? (raw.kind === 'group' || raw.kind === 'channel' || raw.kind === 'private' ? raw.kind : undefined);
  const normalized: RouteMatchConfig = {
    adapter: raw.adapter,
    endpoint: raw.endpoint,
    scene,
    sceneId: raw.sceneId,
    hasMedia: raw.hasMedia,
    contentContains: raw.contentContains,
  };
  const hasConstraint = Boolean(
    normalized.adapter
    || normalized.endpoint
    || normalized.scene
    || normalized.sceneId
    || normalized.hasMedia?.length
    || normalized.contentContains,
  );
  return hasConstraint ? [normalized] : [];
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
