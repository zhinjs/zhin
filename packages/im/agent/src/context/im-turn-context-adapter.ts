import {
  QUOTE_CONTEXT_SYSTEM_EXTRA_KEY,
  resolveIMSessionIdFromMessage,
  senderRolesFromMessage,
  type AgentTurnMessage,
  type Message,
} from '@zhin.js/core';
import type { TurnContextView } from './turn-envelope.js';
import { readInboundMediaRefs } from '../media/inbound-refs.js';
import type { TurnMedia } from '../turn/turn-ingress.js';

/** IM ingress-only adapter. Agent context implementation consumes TurnContextView. */
export function turnContextViewFromMessage(message: Message): TurnContextView {
  const scope = message.$channel?.type;
  if (scope !== 'private' && scope !== 'group' && scope !== 'channel') {
    throw new TypeError('IM Turn context requires a private, group, or channel scope');
  }
  const platform = String(message.$adapter ?? '').trim();
  const endpoint = String(message.$endpoint ?? '').trim();
  const sceneId = String(message.$channel?.id ?? '').trim();
  const subjectId = String(message.$sender?.id ?? '').trim();
  if (!platform || !endpoint || !sceneId || !subjectId) {
    throw new TypeError('IM Turn context requires platform, endpoint, scene, and sender identity');
  }
  return Object.freeze({
    origin: Object.freeze({
      kind: 'im',
      platform,
      endpoint,
      scope,
      sceneId,
      ...(message.$id ? { messageId: String(message.$id) } : {}),
    }),
    principal: Object.freeze({
      subjectId,
      ...(message.$sender?.name ? { displayName: message.$sender.name } : {}),
      roles: Object.freeze([...senderRolesFromMessage(message)]),
    }),
    session: Object.freeze({ key: resolveIMSessionIdFromMessage(message) }),
  });
}

export function resolveQuoteSystemHint(message?: AgentTurnMessage): string | undefined {
  const hint = message?.extra?.[QUOTE_CONTEXT_SYSTEM_EXTRA_KEY];
  return typeof hint === 'string' && hint.trim() ? hint.trim() : undefined;
}

/** IM ingress-only projection into the canonical Turn media contract. */
export function turnMediaFromMessage(message: Message): readonly TurnMedia[] {
  return Object.freeze(readInboundMediaRefs(message).map(({ type, media }) => Object.freeze({
    kind: normalizeMediaKind(type),
    source: Object.freeze({
      kind: media.kind === 'file' ? 'platform_ref' as const : media.kind,
      value: media.value,
    }),
    ...(media.mime_type ? { mimeType: media.mime_type } : {}),
    ...(media.file_name ? { name: media.file_name } : {}),
  })));
}

function normalizeMediaKind(type: string): TurnMedia['kind'] {
  if (type === 'image' || type === 'video' || type === 'file') return type;
  return 'audio';
}
