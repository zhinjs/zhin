import type { Client, MemberInfo } from '@icqqjs/icqq';
import type { EndpointManagement } from 'zhin.js/adapter';

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
async function freshMember(client: Client, group: number, user: number): Promise<MemberInfo | undefined> {
  try {
    const member = await client.getGroupMemberInfo(group, user, true);
    return member.user_id === user && member.group_id === group ? member : undefined;
  } catch {
    return undefined;
  }
}

async function requireBotRole(client: Client, group: number, roles: readonly string[], message: string): Promise<void> {
  const self = await freshMember(client, group, client.uin);
  if (!self || !roles.includes(self.role)) throw new Error(message);
}

function confirmed(ok: unknown, what: string): void {
  if (ok === false) throw new Error(`QQ did not confirm ${what}`);
}

/**
 * ADR 0044 action ports of the icqq endpoint. Where the bot's role decides the outcome the role is
 * read fresh from the platform first, so a stale cache can neither allow nor refuse the action.
 */
export function createIcqqActionPorts(getClient: () => Client): ActionPorts {
  return {
    async pokeUser(userId, groupId) {
      const client = getClient();
      const user = numericId(userId);
      confirmed(
        groupId === undefined
          ? await client.pickFriend(user).poke(false)
          : await client.sendGroupPoke(numericId(groupId), user),
        'poke',
      );
    },
    async unmuteGroupMember(groupId, userId) {
      const client = getClient();
      const group = numericId(groupId);
      await requireBotRole(client, group, ['owner', 'admin'], 'Bot is not a group admin');
      confirmed(await client.setGroupBan(group, numericId(userId), 0), 'unmute');
    },
    async muteAllGroupMembers(groupId, enabled) {
      const client = getClient();
      const group = numericId(groupId);
      await requireBotRole(client, group, ['owner', 'admin'], 'Bot is not a group admin');
      confirmed(await client.setGroupWholeBan(group, enabled), 'whole-group mute');
    },
    async setGroupCard(groupId, userId, card) {
      const client = getClient();
      const group = numericId(groupId);
      const user = numericId(userId);
      if (user !== client.uin) await requireBotRole(client, group, ['owner', 'admin'], 'Bot is not a group admin');
      confirmed(await client.setGroupCard(group, user, card), 'card change');
    },
    async setGroupTitle(groupId, userId, title, durationSeconds) {
      const client = getClient();
      const group = numericId(groupId);
      const user = numericId(userId);
      await requireBotRole(client, group, ['owner'], 'Only the group owner can set special titles');
      if (!await freshMember(client, group, user)) throw new Error('Target is not a group member');
      confirmed(await client.setGroupSpecialTitle(group, user, title, durationSeconds ?? -1), 'title change');
    },
    async setGroupEssence(groupId, messageId, enabled) {
      const client = getClient();
      await requireBotRole(client, numericId(groupId), ['owner', 'admin'], 'Bot is not a group admin');
      if (enabled) await client.setEssenceMessage(messageId);
      else await client.removeEssenceMessage(messageId);
    },
    async inviteGroupMember(groupId, userId) {
      const client = getClient();
      const group = numericId(groupId);
      const user = numericId(userId);
      if (await freshMember(client, group, user)) throw new Error('Target is already a group member');
      confirmed(await client.inviteFriend(group, user), 'invitation');
    },
  };
}
