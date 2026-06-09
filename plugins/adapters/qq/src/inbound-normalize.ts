/**
 * QQ 官方 API v2 入站 WebSocket payload 归一化（group_openid → group_id 等）。
 * qq-official-bot 解析层仍按旧字段名取值，未归一化时群 @ 可能解析失败并被 SDK 静默丢弃。
 */

export type QqWsPacket = {
  d?: Record<string, unknown>;
  id?: string;
  t?: string;
};

const GROUP_MESSAGE_EVENTS = new Set([
  'GROUP_AT_MESSAGE_CREATE',
  'GROUP_MESSAGE_CREATE',
]);

export function normalizeQqInboundWsPayload(event: string, packet: QqWsPacket): void {
  const d = packet.d;
  if (!d || typeof d !== 'object') return;

  if (GROUP_MESSAGE_EVENTS.has(event)) {
    if (!d.group_id && typeof d.group_openid === 'string') {
      d.group_id = d.group_openid;
    }

    const author = d.author;
    if (author && typeof author === 'object') {
      const a = author as Record<string, unknown>;
      if (!a.id) {
        a.id = a.member_openid ?? a.user_openid ?? a.id;
      }
      if (!a.username && !a.user_name) {
        a.username = a.member_openid ?? a.user_openid ?? 'unknown';
      }
    }

    if (!Array.isArray(d.mentions) && typeof d.content === 'string') {
      const mentions: Array<{ id: string }> = [];
      const re = /<@!?(\d+)>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(d.content))) {
        mentions.push({ id: m[1]! });
      }
      if (mentions.length) d.mentions = mentions;
    }

    if (Array.isArray(d.attachments)) {
      for (const att of d.attachments) {
        if (att && typeof att === 'object' && (att as Record<string, unknown>).url == null) {
          (att as Record<string, unknown>).url = '';
        }
      }
    }

    d.__zhin_group_at = event === 'GROUP_AT_MESSAGE_CREATE';
  }
}
