import type { Segment } from 'zhin.js';
import type { QQAdapter } from './adapter.js';

type MentionWire = {
  id?: string;
  member_openid?: string;
  username?: string;
  nickname?: string;
};

type QQEndpointLike = {
  $id: string;
  $platformUserId?: string;
  $config: { name?: string; appid?: string; nickname?: string };
};

function mentionWireId(row: MentionWire): string {
  return String(row.id ?? row.member_openid ?? '').trim();
}

function mentionWireName(row: MentionWire): string | undefined {
  const name = row.username ?? row.nickname;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

function endpointLookupIds(endpoint: QQEndpointLike): string[] {
  const cfg = endpoint.$config;
  return [
    endpoint.$platformUserId,
    cfg.appid,
    cfg.name,
    endpoint.$id,
  ].filter((id): id is string => Boolean(id)).map(String);
}

function resolveEndpointDisplayName(endpoint: QQEndpointLike): string | undefined {
  const cfg = endpoint.$config;
  return cfg.nickname?.trim() || cfg.name?.trim() || endpoint.$id;
}

/** 为 canonical mention 段补齐展示名（平台 payload / endpoint 配置）。 */
export function enrichCanonicalMentionNames(
  segments: Segment[],
  adapter: QQAdapter,
  wireMentions?: MentionWire[],
): Segment[] {
  const nameById = new Map<string, string>();
  for (const row of wireMentions ?? []) {
    const id = mentionWireId(row);
    const name = mentionWireName(row);
    if (id && name) nameById.set(id, name);
  }

  for (const endpoint of adapter.endpoints.values()) {
    const display = resolveEndpointDisplayName(endpoint);
    if (!display) continue;
    for (const id of endpointLookupIds(endpoint)) {
      if (!nameById.has(id)) nameById.set(id, display);
    }
  }

  return segments.map((seg) => {
    if (seg.type !== 'mention') return seg;
    const data = seg.data as { target?: string; name?: string };
    const target = String(data.target ?? '').trim();
    if (!target || data.name) return seg;
    const name = nameById.get(target);
    if (!name) return seg;
    return { ...seg, data: { target, name } };
  });
}
