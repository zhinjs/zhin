import { Notice, type NoticeBase } from '../notice.js';
import { Request, type RequestBase } from '../request.js';
import {
  composeSideEventName,
  parseSideEventName,
} from './base.js';
import { KOOK_NOTICE_PARTS_MAP, ONEBOT_NOTICE_PARTS_MAP, SLACK_NOTICE_PARTS_MAP, type ComposedNoticeName, type ComposedRequestName, type SideEventParts } from './types.js';

export type SideEventPlatform = 'onebot' | 'icqq' | 'napcat' | 'kook' | (string & {});

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
  return `${kind}:${time}_${type}_${scope}_${sub}`;
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
  if (subType === 'title') return { scene_type: 'notify', sub_type: 'title_change' };
  if (subType === 'profile_like') return { scene_type: 'notify', sub_type: 'profile_like' };
  return { scene_type: 'notify', sub_type: subType ?? 'unknown' };
}

function resolveEssenceNoticeParts(subType: string | undefined): SideEventParts {
  return subType === 'add'
    ? { scene_type: 'group', sub_type: 'essence_add' }
    : { scene_type: 'group', sub_type: 'essence_delete' };
}

/**
 * 将平台原始 notice_type 映射为标准 `$scene_type` + `$sub_type`。
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

  if (platform === 'kook') {
    return KOOK_NOTICE_PARTS_MAP[raw] ?? { scene_type: 'kook', sub_type: raw };
  }

  if (platform === 'slack') {
    return SLACK_NOTICE_PARTS_MAP[raw] ?? { scene_type: 'slack', sub_type: raw };
  }

  if (raw === 'notify') {
    const handler = options?.notify_handler ?? resolveNotifyNoticeParts;
    return handler(subType, isGroup);
  }

  if (raw === 'essence') {
    return resolveEssenceNoticeParts(subType);
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
 * 将平台原始 request_type 映射为标准 `$scene_type` + `$sub_type`。
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

/** 组合完整 Notice 类型名（兼容旧 API） */
export function mapNoticeType(
  platform: SideEventPlatform,
  raw: string,
  options?: Parameters<typeof mapNoticeParts>[2],
): ComposedNoticeName {
  const parts = mapNoticeParts(platform, raw, options);
  return composeSideEventName('notice', parts.scene_type, parts.sub_type) as ComposedNoticeName;
}

/** 组合完整 Request 类型名（兼容旧 API） */
export function mapRequestType(
  platform: SideEventPlatform,
  raw: string,
  subType?: string,
): ComposedRequestName {
  const parts = mapRequestParts(platform, raw, subType);
  return composeSideEventName('request', parts.scene_type, parts.sub_type) as ComposedRequestName;
}

export function senderFromId(id: unknown, name?: string) {
  if (id == null || id === '') return undefined;
  const s = String(id);
  return { id: s, name: name ?? s };
}

export function buildNotice<T extends object>(input: T, format: NoticeBase) {
  return Notice.from(input, format);
}

export function buildRequest<T extends object>(input: T, format: RequestBase) {
  return Request.from(input, format);
}
