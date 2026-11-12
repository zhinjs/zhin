import type { ToolExecutionContext } from '@zhin.js/tool';
import { messages as t } from './messages.js';

export type DiscordToolContext = ToolExecutionContext<unknown, 'discord'>;

/**
 * The trusted turn owns the guild channel; model input cannot select another one. Platform
 * (`platform-permission:*`) and Bot (`bot-permission:*`) permits are judged in the current
 * conversation, so tools that rely on them act on the current guild / channel only (ADR 0056 §5).
 */
export function currentGuildChannel(context: DiscordToolContext): { guildId: string; channelId: string } {
  const { origin } = context;
  const conversation = origin?.kind === 'im' && origin.platform === 'discord' ? origin.conversation : undefined;
  const guildId = conversation?.kind === 'channel' && conversation.parent?.kind === 'channel' ? conversation.parent.id : '';
  if (!conversation || !guildId) throw new Error(t(context.locale, 'guildChannelRequired'));
  context.signal?.throwIfAborted();
  return { guildId, channelId: conversation.threadId ?? conversation.id };
}

interface RoleLike { readonly id: string; readonly position: number; readonly managed?: boolean }
interface GuildLike {
  readonly id: string;
  readonly ownerId: string;
  readonly roles: { fetch(id: string): Promise<RoleLike | null> };
  readonly members: { fetch(id: string): Promise<{ readonly roles: { readonly highest: RoleLike } }> };
}

/**
 * Discord role hierarchy for the requester (the Bot's own hierarchy is enforced by Discord): a member
 * with `manage_roles` may only manage roles strictly below their highest role; the guild owner is exempt.
 * Without this check a low-placed manager could have the Bot grant them a higher role.
 */
export async function requireRoleBelowRequester(context: DiscordToolContext, guild: GuildLike, roleId: string): Promise<string | undefined> {
  const role = await guild.roles.fetch(roleId);
  context.signal?.throwIfAborted();
  if (!role || role.id === guild.id) return t(context.locale, 'roleMissing', { p0: roleId });
  if (role.managed) return t(context.locale, 'roleAboveRequester', { p0: roleId });
  const requester = context.principal?.subjectId?.trim();
  if (!requester) return t(context.locale, 'roleAboveRequester', { p0: roleId });
  if (requester === guild.ownerId) return undefined;
  const member = await guild.members.fetch(requester);
  context.signal?.throwIfAborted();
  return role.position < member.roles.highest.position ? undefined : t(context.locale, 'roleAboveRequester', { p0: roleId });
}
