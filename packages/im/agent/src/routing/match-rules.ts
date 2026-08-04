import { type AgentBindingConfig, type RouteMatchConfig } from '../config/types.js';

type RawMatchRule = RouteMatchConfig & { kind?: string };

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
