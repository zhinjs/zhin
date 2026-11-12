/**
 * ADR 0056 §2 (revised): where a sender's zhin chat roles come from on the conversation's scope
 * chain. `sender.chatRole` is the highest role effective in the conversation; `sender.chatRoleLevels`
 * records, for every role, the topmost level at which the sender holds that role (or a higher one).
 * Host-wide capabilities (exec, files, restart, global memory, …) read the level, not just the role:
 * a conversation-level `owner` is not the owner of the host.
 */

export type ChatRoleName = 'owner' | 'admin' | 'trusted';
export type ChatRoleLevel = 'global' | 'adapter' | 'endpoint' | 'conversation';

/** Scope levels from the top (`global`) down. */
export const CHAT_ROLE_LEVELS: readonly ChatRoleLevel[] = Object.freeze(['global', 'adapter', 'endpoint', 'conversation']);

/** Per role: the topmost level at which the sender holds that role or a higher one. */
export type ChatRoleLevels = Readonly<Partial<Record<ChatRoleName, ChatRoleLevel>>>;

const RANK: Readonly<Record<ChatRoleName, number>> = Object.freeze({ trusted: 1, admin: 2, owner: 3 });

export function isChatRoleLevel(value: unknown): value is ChatRoleLevel {
  return value === 'global' || value === 'adapter' || value === 'endpoint' || value === 'conversation';
}

const isRole = (value: unknown): value is ChatRoleName => value === 'owner' || value === 'admin' || value === 'trusted';

/** Validated copy of a `chatRoleLevels` value; undefined when nothing valid remains. */
export function normalizeChatRoleLevels(value: unknown): ChatRoleLevels | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Partial<Record<ChatRoleName, ChatRoleLevel>> = {};
  for (const role of ['owner', 'admin', 'trusted'] as const) {
    const level = (value as Record<string, unknown>)[role];
    if (isChatRoleLevel(level)) result[role] = level;
  }
  return Object.keys(result).length ? Object.freeze(result) : undefined;
}

interface SenderRoleFacts {
  readonly chatRole?: unknown;
  readonly chatRoleLevels?: unknown;
}

/**
 * Whether the sender holds `role` (or a higher one) at `level` or above on this conversation's
 * chain. Without `chatRoleLevels` a held role counts as conversation-level only (fail closed).
 */
export function chatRoleHeldAt(sender: SenderRoleFacts | null | undefined, role: ChatRoleName, level: ChatRoleLevel): boolean {
  if (!sender || !isRole(sender.chatRole) || RANK[sender.chatRole] < RANK[role]) return false;
  const levels = normalizeChatRoleLevels(sender.chatRoleLevels);
  const held = levels?.[role] ?? 'conversation';
  return CHAT_ROLE_LEVELS.indexOf(held) <= CHAT_ROLE_LEVELS.indexOf(level);
}

/**
 * The sender's role for host-wide trust: `owner` only for a global owner; a lower-level owner counts
 * as `admin` there. `admin` / `trusted` are unchanged (they carry no host-wide authority).
 */
export function hostChatRole(sender: SenderRoleFacts | null | undefined): ChatRoleName | undefined {
  if (!sender || !isRole(sender.chatRole)) return undefined;
  if (sender.chatRole !== 'owner') return sender.chatRole;
  return chatRoleHeldAt(sender, 'owner', 'global') ? 'owner' : 'admin';
}
