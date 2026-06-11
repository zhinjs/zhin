import type { Message, SenderRole } from '@zhin.js/core';

function senderFlagsFromRoles(
  sender_roles?: readonly SenderRole[],
): { isMaster?: boolean; isTrusted?: boolean } {
  if (!sender_roles?.length) return {};
  if (sender_roles.includes('master')) return { isMaster: true };
  if (sender_roles.includes('trusted')) return { isTrusted: true };
  return { isMaster: false, isTrusted: false };
}

export function mockCommMessage(overrides: {
  adapter?: string;
  endpoint?: string;
  senderId?: string;
  scope?: 'private' | 'group' | 'channel';
  sceneId?: string;
  /** @deprecated 使用 isMaster / isTrusted */
  sender_roles?: readonly SenderRole[];
  isMaster?: boolean;
  isTrusted?: boolean;
  role?: string;
  extra?: Record<string, unknown>;
} = {}): Message<any> {
  const scope = overrides.scope ?? 'private';
  const adapter = overrides.adapter ?? 'qq';
  const endpoint = overrides.endpoint ?? 'endpoint1';
  const senderId = overrides.senderId ?? 'user1';
  const fromRoles = senderFlagsFromRoles(overrides.sender_roles);
  const isMaster = overrides.isMaster ?? fromRoles.isMaster;
  const isTrusted = overrides.isTrusted ?? fromRoles.isTrusted;
  return {
    $adapter: adapter,
    $endpoint: endpoint,
    $sender: {
      id: senderId,
      ...(overrides.role !== undefined ? { role: overrides.role } : {}),
      ...(isMaster !== undefined ? { isMaster } : {}),
      ...(isTrusted !== undefined ? { isTrusted } : {}),
    },
    $channel: {
      type: scope,
      id: overrides.sceneId ?? (scope === 'private' ? senderId : 'scene1'),
    },
    extra: overrides.extra,
  } as Message<any>;
}
