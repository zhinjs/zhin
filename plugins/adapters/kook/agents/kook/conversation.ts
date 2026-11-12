import type { ToolExecutionContext } from '@zhin.js/tool';
import { messages as t } from './messages.js';

export type KookToolContext = ToolExecutionContext<unknown, 'kook'>;

/**
 * The trusted turn owns the server; model input cannot select another one. Platform (`platform:*` /
 * `platform-permission:*`) and Bot (`bot-permission:*`) permits are judged in the current conversation,
 * so tools that rely on them act on the current server only (ADR 0056 §5).
 */
export function currentGuild(context: KookToolContext): string {
  const { origin } = context;
  const conversation = origin?.kind === 'im' && origin.platform === 'kook' ? origin.conversation : undefined;
  const guildId = conversation?.kind === 'channel' && conversation.parent?.kind === 'channel' ? conversation.parent.id : '';
  if (!guildId) throw new Error(t(context.locale, 'guildRequired'));
  context.signal?.throwIfAborted();
  return guildId;
}

/** 「全体成员」：每个成员都持有、不能授予或撤销的基础角色。 */
const EVERYONE_ROLE_ID = '0';

interface KookHierarchyClient {
  getGuildInfo(guildId: string): Promise<{ readonly user_id?: unknown }>;
  pickGuild(guildId: string): { getRoleList(): Promise<readonly { readonly role_id: unknown; readonly position: unknown }[]> };
  readonly request: { get(url: string, options: { params: Record<string, string> }): Promise<{ readonly data?: unknown }> };
}

interface GuildHierarchy {
  readonly ownerId?: string;
  /** role id → KOOK `position`：值越小越靠前、优先级越高（KOOK 开发者文档「服务器角色权限」）。 */
  readonly positions: ReadonlyMap<string, number>;
}

async function guildHierarchy(context: KookToolContext, guildId: string): Promise<GuildHierarchy> {
  const client = context.$client as unknown as KookHierarchyClient;
  const [info, roles] = await Promise.all([client.getGuildInfo(guildId), client.pickGuild(guildId).getRoleList()]);
  context.signal?.throwIfAborted();
  const positions = new Map<string, number>();
  for (const role of roles) {
    const position = Number(role.position);
    if (role.role_id != null && Number.isFinite(position)) positions.set(String(role.role_id), position);
  }
  const ownerId = info?.user_id != null && String(info.user_id) ? String(info.user_id) : undefined;
  return { ...(ownerId ? { ownerId } : {}), positions };
}

/** The member's highest role as its smallest KOOK `position`; `undefined` when they hold no ranked role. */
async function highestPosition(context: KookToolContext, guildId: string, userId: string, hierarchy: GuildHierarchy): Promise<number | undefined> {
  const client = context.$client as unknown as KookHierarchyClient;
  const { data } = await client.request.get('/v3/user/view', { params: { user_id: userId, guild_id: guildId } });
  context.signal?.throwIfAborted();
  const held = Array.isArray((data as { roles?: unknown } | undefined)?.roles) ? (data as { roles: unknown[] }).roles : [];
  let best: number | undefined;
  for (const id of held.map(String)) {
    if (id === EVERYONE_ROLE_ID) continue;
    const position = hierarchy.positions.get(id);
    if (position !== undefined && (best === undefined || position < best)) best = position;
  }
  return best;
}

function requesterOf(context: KookToolContext): string | undefined {
  return context.principal?.subjectId?.trim() || undefined;
}

/**
 * KOOK role hierarchy for the requester (the Bot's own hierarchy is enforced by KOOK): a member with
 * `manage_roles` may only grant / revoke roles strictly below their highest role — a larger `position`,
 * since smaller is higher in KOOK. The server owner is exempt; 「全体成员」 and unknown roles are refused.
 * Without this check a low-placed manager could have the Bot grant them a higher role.
 */
export async function requireRoleBelowRequester(context: KookToolContext, guildId: string, roleId: string): Promise<string | undefined> {
  const id = String(roleId).trim();
  const hierarchy = await guildHierarchy(context, guildId);
  const target = hierarchy.positions.get(id);
  if (id === EVERYONE_ROLE_ID || target === undefined) return t(context.locale, 'roleMissing', { p0: roleId });
  const requester = requesterOf(context);
  if (!requester) return t(context.locale, 'roleAboveRequester', { p0: roleId });
  if (requester === hierarchy.ownerId) return undefined;
  const best = await highestPosition(context, guildId, requester, hierarchy);
  return best !== undefined && target > best ? undefined : t(context.locale, 'roleAboveRequester', { p0: roleId });
}

/**
 * KOOK member hierarchy for the requester: a manager may only act on members whose highest role is
 * strictly below their own (the server owner is exempt and can never be targeted).
 */
export async function requireMemberBelowRequester(context: KookToolContext, guildId: string, userId: string): Promise<string | undefined> {
  const hierarchy = await guildHierarchy(context, guildId);
  const requester = requesterOf(context);
  const target = String(userId).trim();
  if (!requester || target === hierarchy.ownerId) return t(context.locale, 'memberAboveRequester', { p0: userId });
  if (requester === hierarchy.ownerId) return undefined;
  const mine = await highestPosition(context, guildId, requester, hierarchy);
  if (mine === undefined) return t(context.locale, 'memberAboveRequester', { p0: userId });
  const theirs = await highestPosition(context, guildId, target, hierarchy);
  return theirs === undefined || theirs > mine ? undefined : t(context.locale, 'memberAboveRequester', { p0: userId });
}
