import { parseSideEventName, type SideEventParts } from '@zhin.js/core';
import { NOTICE_OVERRIDES_BY_FLAVOR, ONEBOT_NOTICE_PARTS_MAP } from './maps.js';

/** `onebot` / `napcat` / `icqq`；其他字符串按标准 OneBot 处理。 */
export type SideEventPlatform = 'onebot' | 'icqq' | 'napcat' | (string & {});

export interface OneBotLikeRawEvent {
  notice_type?: string;
  request_type?: string;
  sub_type?: string;
  group_id?: number | string;
  user_id?: number | string;
  operator_id?: number | string;
  flag?: string;
  time?: number;
  self_id?: number | string;
  [key: string]: unknown;
}

/** 去重用：notice / request 无稳定 id 时组合键 */
export function resolveSideEventDedupeKey(
  data: OneBotLikeRawEvent,
  kind: 'notice' | 'request',
): string {
  if (data.flag != null && String(data.flag) !== '') {
    return `${kind}:${data.flag}`;
  }
  const time = data.time ?? 0;
  const type = data.notice_type ?? data.request_type ?? kind;
  const scope = data.group_id ?? data.user_id ?? '';
  const sub = data.sub_type ?? '';
  // 群事件的 scope 是群号：不带成员和操作人时，同一群的两次入群（平台不给 time 时尤甚）会撞成同一个键，后一次被当重复丢掉。
  const member = data.group_id != null ? (data.user_id ?? '') : '';
  const operator = data.operator_id ?? '';
  return `${kind}:${time}_${type}_${scope}_${sub}_${member}_${operator}`;
}

function resolveNotifyNoticeParts(
  subType: string | undefined,
  isGroup: boolean,
): SideEventParts {
  if (subType === 'poke') {
    return isGroup
      ? { scene_type: 'group', sub_type: 'poke' }
      : { scene_type: 'friend', sub_type: 'poke' };
  }
  if (subType === 'input_status') return { scene_type: 'notify', sub_type: 'input_status' };
  // 群头衔变更属于群场景（否则没有 conversation，进不了 conversation_events）
  if (subType === 'title') return { scene_type: isGroup ? 'group' : 'notify', sub_type: 'title_change' };
  if (subType === 'profile_like') return { scene_type: 'notify', sub_type: 'profile_like' };
  return { scene_type: 'notify', sub_type: subType ?? 'unknown' };
}

function resolveEssenceNoticeParts(subType: string | undefined): SideEventParts {
  return subType === 'add'
    ? { scene_type: 'group', sub_type: 'essence_add' }
    : { scene_type: 'group', sub_type: 'essence_delete' };
}

/**
 * 将 OneBot 系原始 notice_type 映射为标准 `scene_type` + `sub_type`。
 * 协议差异（如 icqq 把 notice_type 拆成 group + sub_type）走 `maps.ts` 的覆盖表。
 */
export function mapNoticeParts(
  platform: SideEventPlatform,
  raw: string,
  options?: {
    sub_type?: string;
    is_group?: boolean;
    notify_handler?: (subType: string | undefined, isGroup: boolean) => SideEventParts;
  },
): SideEventParts {
  const subType = options?.sub_type;
  const isGroup = options?.is_group ?? false;

  if (raw === 'notify') {
    const handler = options?.notify_handler ?? resolveNotifyNoticeParts;
    return handler(subType, isGroup);
  }

  if (raw === 'essence') {
    return resolveEssenceNoticeParts(subType);
  }

  const overrides = NOTICE_OVERRIDES_BY_FLAVOR[platform];
  if (overrides && (raw === 'group' || raw === 'friend') && subType) {
    return overrides[`${raw}.${subType}`] ?? { scene_type: raw, sub_type: subType };
  }

  if (ONEBOT_NOTICE_PARTS_MAP[raw]) {
    return ONEBOT_NOTICE_PARTS_MAP[raw];
  }

  if (raw.startsWith('notice.')) {
    const parsed = parseSideEventName(raw);
    if (parsed.scene_type && parsed.sub_type) {
      return { scene_type: parsed.scene_type, sub_type: parsed.sub_type };
    }
    const suffix = raw.slice('notice.'.length).replace(/\./g, '_');
    if (ONEBOT_NOTICE_PARTS_MAP[suffix]) return ONEBOT_NOTICE_PARTS_MAP[suffix];
    return { scene_type: parsed.scene_type ?? 'unknown', sub_type: parsed.sub_type ?? suffix };
  }

  if (platform === 'icqq' || platform === 'onebot' || platform === 'napcat') {
    const dotted = raw.replace(/_/g, '.');
    const parsed = parseSideEventName(`notice.${dotted}`);
    return {
      scene_type: parsed.scene_type ?? dotted.split('.')[0] ?? 'unknown',
      sub_type: parsed.sub_type ?? (dotted.split('.').slice(1).join('.') || raw),
    };
  }

  return { scene_type: platform, sub_type: raw };
}

/**
 * 将 OneBot 系原始 request_type 映射为标准 `scene_type` + `sub_type`。
 */
export function mapRequestParts(
  _platform: SideEventPlatform,
  raw: string,
  subType?: string,
): SideEventParts {
  if (raw === 'friend' || raw.startsWith('friend')) {
    return { scene_type: 'friend', sub_type: 'add' };
  }
  if (raw === 'group' || raw.startsWith('group')) {
    return { scene_type: 'group', sub_type: subType === 'invite' ? 'invite' : 'add' };
  }
  if (raw.startsWith('request.')) {
    const parsed = parseSideEventName(raw);
    return {
      scene_type: parsed.scene_type ?? 'unknown',
      sub_type: parsed.sub_type ?? 'unknown',
    };
  }
  return { scene_type: raw, sub_type: subType ?? 'unknown' };
}
