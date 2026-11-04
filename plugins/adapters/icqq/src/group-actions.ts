import type { Client, MemberInfo } from '@icqqjs/icqq';
import { createEndpointOperation, type EndpointManagement, type EndpointOperation } from 'zhin.js/adapter';

type ActionPorts = Pick<
  EndpointManagement,
  | 'pokeUser'
  | 'unmuteGroupMember'
  | 'muteAllGroupMembers'
  | 'setGroupCard'
  | 'setGroupTitle'
  | 'setGroupEssence'
  | 'inviteGroupMember'
>;

function numericId(value: string): number {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) throw new Error('Invalid QQ identifier');
  return id;
}

/** Uncached member lookup; `pickMember` and the cached roster would report stale roles. */
async function freshMember(operation: EndpointOperation, client: Client, group: number, user: number): Promise<MemberInfo | undefined> {
  try {
    const member = await operation.prepare(() => client.getGroupMemberInfo(group, user, true));
    return member.user_id === user && member.group_id === group ? member : undefined;
  } catch {
    return undefined;
  }
}

async function requireBotRole(operation: EndpointOperation, client: Client, group: number, roles: readonly string[], message: string): Promise<void> {
  const self = await freshMember(operation, client, group, client.uin);
  if (!self || !roles.includes(self.role)) throw new Error(message);
}

function confirmed(ok: unknown, what: string): void {
  if (ok === false) throw new Error(`QQ did not confirm ${what}`);
}

/**
 * ADR 0044 action ports of the icqq endpoint. Where the bot's role decides the outcome the role is
 * read fresh from the platform first, so a stale cache can neither allow nor refuse the action.
 * Each request carries its own lifetime: reads are `prepare`, the native effect is `run`.
 */
export function createIcqqActionPorts(getClient: () => Client): ActionPorts {
  return {
    async pokeUser({ userId, groupId, signal }) {
      const client = getClient();
      const operation = createEndpointOperation({ signal });
      const user = numericId(userId);
      confirmed(
        groupId === undefined
          ? await operation.run(() => client.pickFriend(user).poke(false))
          : await operation.run(() => client.sendGroupPoke(numericId(groupId), user)),
        'poke',
      );
    },
    async unmuteGroupMember({ groupId, userId, signal }) {
      const client = getClient();
      const operation = createEndpointOperation({ signal });
      const group = numericId(groupId);
      await requireBotRole(operation, client, group, ['owner', 'admin'], 'Bot is not a group admin');
      confirmed(await operation.run(() => client.setGroupBan(group, numericId(userId), 0)), 'unmute');
    },
    async muteAllGroupMembers({ groupId, enabled, signal }) {
      const client = getClient();
      const operation = createEndpointOperation({ signal });
      const group = numericId(groupId);
      await requireBotRole(operation, client, group, ['owner', 'admin'], 'Bot is not a group admin');
      confirmed(await operation.run(() => client.setGroupWholeBan(group, enabled)), 'whole-group mute');
    },
    async setGroupCard({ groupId, userId, card, signal }) {
      const client = getClient();
      const operation = createEndpointOperation({ signal });
      const group = numericId(groupId);
      const user = numericId(userId);
      if (user !== client.uin) await requireBotRole(operation, client, group, ['owner', 'admin'], 'Bot is not a group admin');
      confirmed(await operation.run(() => client.setGroupCard(group, user, card)), 'card change');
    },
    async setGroupTitle({ groupId, userId, title, durationSeconds, signal }) {
      const client = getClient();
      const operation = createEndpointOperation({ signal });
      const group = numericId(groupId);
      const user = numericId(userId);
      await requireBotRole(operation, client, group, ['owner'], 'Only the group owner can set special titles');
      if (!await freshMember(operation, client, group, user)) throw new Error('Target is not a group member');
      confirmed(await operation.run(() => client.setGroupSpecialTitle(group, user, title, durationSeconds ?? -1)), 'title change');
    },
    async setGroupEssence({ groupId, messageId, enabled, signal }) {
      const client = getClient();
      const operation = createEndpointOperation({ signal });
      await requireBotRole(operation, client, numericId(groupId), ['owner', 'admin'], 'Bot is not a group admin');
      if (enabled) await operation.run(() => client.setEssenceMessage(messageId));
      else await operation.run(() => client.removeEssenceMessage(messageId));
    },
    async inviteGroupMember({ groupId, userId, signal }) {
      const client = getClient();
      const operation = createEndpointOperation({ signal });
      const group = numericId(groupId);
      const user = numericId(userId);
      if (await freshMember(operation, client, group, user)) throw new Error('Target is already a group member');
      confirmed(await operation.run(() => client.inviteFriend(group, user)), 'invitation');
    },
  };
}
