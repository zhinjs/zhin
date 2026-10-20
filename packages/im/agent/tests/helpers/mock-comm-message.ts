import type { Message, SenderRole } from '@zhin.js/core';

export function mockCommMessage(overrides: {
  adapter?: string;
  endpoint?: string;
  senderId?: string;
  scope?: 'private' | 'group' | 'channel';
  sceneId?: string;
  sender_roles?: readonly SenderRole[];
  isMaster?: boolean;
  isTrusted?: boolean;
  role?: string;
  extra?: Record<string, unknown>;
} = {}): Message<{ extra?: Record<string, unknown> }> {
  const scope = overrides.scope ?? 'private';
  const adapter = overrides.adapter ?? 'qq';
  const endpoint = overrides.endpoint ?? 'endpoint1';
  const senderId = overrides.senderId ?? 'user1';
  const roles: SenderRole[] = overrides.sender_roles
    ? [...overrides.sender_roles]
    : overrides.isMaster
      ? ['master']
      : overrides.isTrusted
        ? ['trusted']
        : ['user'];
  const conversation = {
    endpoint: { adapter, id: endpoint },
    kind: scope,
    id: overrides.sceneId ?? (scope === 'private' ? senderId : 'scene1'),
  } as const;
  return {
    conversation,
    content: '',
    generation: 1,
    metadata: overrides.role ? { senderRole: overrides.role } : {},
    sender: { id: senderId, roles },
    endpointId: endpoint,
    clientAdapter: adapter,
    extra: overrides.extra,
    get $client(): unknown { return undefined; },
    $reply: async () => ({ status: 'sent' }),
    $replyFrom: async () => ({ status: 'sent' }),
    $sendTo: async () => ({ status: 'sent' }),
    $replyToPrivate: async () => ({ status: 'sent' }),
    $replyToGroup: async () => ({ status: 'sent' }),
    $replyToChannel: async () => ({ status: 'sent' }),
  };
}
