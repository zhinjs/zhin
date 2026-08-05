/**
 * Extract subscription channel keys from Runtime Message (`input`).
 * Gaps vs legacy: no `$channel` / `$group` — use `conversation` / `metadata`.
 */

export interface ChannelInfo {
  adapterName: string;
  endpointId: string;
  channelType: string;
  channelId: string;
  senderId: string;
  senderName: string;
}

/** Smoke / agent / execute()-without-dispatch fallback. */
export const SMOKE_CHANNEL: ChannelInfo = {
  adapterName: 'smoke',
  endpointId: 'local',
  channelType: 'private',
  channelId: 'global',
  senderId: '',
  senderName: '',
};

export function extractChannelInfo(input: unknown): ChannelInfo {
  if (!input || typeof input !== 'object') return { ...SMOKE_CHANNEL };

  const msg = input as {
    conversation?: {
      endpoint?: { id?: string; adapter?: string };
      kind?: string;
      id?: string;
    };
    sender?: string;
    metadata?: Record<string, unknown>;
  };
  const meta = msg.metadata ?? {};
  const conversation = msg.conversation;
  const channelType = String(
    meta.channelType ?? meta.type ?? meta.channel_type ?? conversation?.kind ?? 'private',
  );
  const channelId = String(
    meta.channelId ?? meta.channel_id ?? conversation?.id ?? SMOKE_CHANNEL.channelId,
  );
  const endpointCapabilityId = typeof conversation?.endpoint?.id === 'string'
    ? conversation.endpoint.id
    : undefined;
  const adapterName = String(
    (endpointCapabilityId?.split('\0').pop() ?? endpointCapabilityId)?.split('~')[0]
    ?? meta.adapter
    ?? SMOKE_CHANNEL.adapterName,
  );
  const endpointId = String(
    meta.endpoint ?? meta.endpointId ?? meta.endpoint_id ?? adapterName,
  );
  const senderId = String(msg.sender ?? meta.senderId ?? '');
  const senderName = String(meta.senderName ?? meta.name ?? '');

  if (!channelId) return { ...SMOKE_CHANNEL, adapterName, endpointId, senderId, senderName };

  return {
    adapterName,
    endpointId,
    channelType,
    channelId,
    senderId,
    senderName,
  };
}
