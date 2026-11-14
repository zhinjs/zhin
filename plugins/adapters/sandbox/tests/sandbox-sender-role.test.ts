import { describe, expect, it } from 'vitest';
import type { ChatRoleReader } from 'zhin.js';
import { sandboxSenderRoleFacts } from '../src/endpoint.js';

/** ADR 0060 §5.4 (P0): the page shows what the server resolved, next to the simulated platform standing. */
describe('sandbox sender role facts', () => {
  const conversation = { endpoint: { id: 'sandbox:local', adapter: 'sandbox' }, kind: 'group', id: 'g' } as never;
  const reader = (facts: ReturnType<ChatRoleReader['factsOf']>) => ({ factsOf: () => facts }) as unknown as ChatRoleReader;

  it('maps zhin roles to the Agent trust tier', () => {
    expect(sandboxSenderRoleFacts(reader({ identity: { adapter: 'sandbox', userId: 'a' }, chatRole: 'owner', chatRoleLevels: { owner: 'global', admin: 'global', trusted: 'global' } }), conversation, 'a'))
      .toEqual({ senderChatRole: 'owner', senderTrustLevel: 'owner' });
    // A conversation-level owner is admin for host-wide trust.
    expect(sandboxSenderRoleFacts(reader({ identity: { adapter: 'sandbox', userId: 'a' }, chatRole: 'owner', chatRoleLevels: { owner: 'conversation' } }), conversation, 'a'))
      .toEqual({ senderChatRole: 'owner', senderTrustLevel: 'trusted_member' });
  });

  it('a simulated 群主 without a zhin role is a group member', () => {
    expect(sandboxSenderRoleFacts(reader({ identity: { adapter: 'sandbox', userId: 'dev-user' } }), conversation, 'dev-user')).toEqual({ senderTrustLevel: 'group_member' });
    expect(sandboxSenderRoleFacts(undefined, conversation, 'dev-user')).toEqual({ senderTrustLevel: 'group_member' });
    const throwing = { factsOf: () => { throw new Error('x'); } } as unknown as ChatRoleReader;
    expect(sandboxSenderRoleFacts(throwing, conversation, 'dev-user')).toEqual({ senderTrustLevel: 'group_member' });
  });
});
