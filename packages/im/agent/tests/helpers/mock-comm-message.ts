import type { ChatRole, Message, PlatformStanding } from '@zhin.js/core';

export function mockCommMessage(overrides: {
  adapter?: string;
  endpoint?: string;
  senderId?: string;
  scope?: 'private' | 'group' | 'channel';
  sceneId?: string;
  /** Highest chat role in the conversation (ADR 0056). */
  chatRole?: ChatRole;
  /** Level the chat role is held at (`sender.chatRoleLevels`); default `global` (host-wide). */
  chatRoleLevel?: 'global' | 'adapter' | 'endpoint' | 'conversation';
  /** Legacy alias: the highest of these chat roles is used. */
  sender_roles?: readonly (ChatRole | 'user')[];
  isMaster?: boolean;
  isTrusted?: boolean;
  /** Normalized platform standing (ADR 0056 §1). */
  platform?: PlatformStanding;
  extra?: Record<string, unknown>;
} = {}): Message<{ extra?: Record<string, unknown> }> {
  const scope = overrides.scope ?? 'private';
  const adapter = overrides.adapter ?? 'qq';
  const endpoint = overrides.endpoint ?? 'endpoint1';
  const senderId = overrides.senderId ?? 'user1';
  const listed = overrides.sender_roles ?? [];
  const chatRole: ChatRole | undefined = overrides.chatRole
    ?? (listed.includes('owner') ? 'owner' : listed.includes('admin') ? 'admin' : listed.includes('trusted') ? 'trusted' : undefined)
    ?? (overrides.isMaster ? 'owner' : overrides.isTrusted ? 'trusted' : undefined);
  const conversation = {
    endpoint: { adapter, id: endpoint },
    kind: scope,
    id: overrides.sceneId ?? (scope === 'private' ? senderId : 'scene1'),
  } as const;
  return {
    conversation,
    content: '',
    generation: 1,
    metadata: {},
    sender: { id: senderId,
      ...(chatRole ? { chatRole, chatRoleLevels: Object.fromEntries((['owner', 'admin', 'trusted'] as const)
        .filter(role => ['trusted', 'admin', 'owner'].indexOf(role) <= ['trusted', 'admin', 'owner'].indexOf(chatRole))
        .map(role => [role, overrides.chatRoleLevel ?? 'global'])) } : {}),
      ...(overrides.platform ? { platform: overrides.platform } : {}) },
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
