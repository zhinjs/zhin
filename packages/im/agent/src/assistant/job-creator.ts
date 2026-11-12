import { expandChatRole, hostChatRole, isChatRole, type ChatRole } from '@zhin.js/core';
import { normalizeDeliveryTarget } from '@zhin.js/plugin-runtime';
import type { ToolInvocationContext } from '@zhin.js/tool';
import type { ScheduleJobCreator } from './types.js';

type CreatorRole = ChatRole | 'user';

/** Chat roles and `user`; persisted jobs from before ADR 0056 stored `master`, read as `owner`. */
function creatorRole(value: unknown): CreatorRole | undefined {
  const role = value === 'master' ? 'owner' : value;
  return isChatRole(role) || role === 'user' ? role : undefined;
}

function creatorRoles(values: readonly unknown[]): readonly CreatorRole[] {
  const roles = [...new Set(values.map(creatorRole).filter((role): role is CreatorRole => role !== undefined))];
  const chat = roles.filter((role) => role !== 'user');
  return chat.length > 0 ? chat : ['user'];
}

function creatorChat(value: unknown): ScheduleJobCreator['chat'] {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as { conversation?: unknown; endpointId?: unknown };
  if (typeof record.endpointId !== 'string' || !record.endpointId) return undefined;
  try {
    return Object.freeze({ conversation: normalizeDeliveryTarget(record.conversation), endpointId: record.endpointId });
  } catch {
    return undefined;
  }
}

/**
 * Capture a persisted creator only from the authenticated invocation principal; an IM origin also
 * records where the creator spoke, so a due run can re-read the creator's current role.
 */
export function scheduleJobCreatorFromPrincipal(
  principal: ToolInvocationContext['principal'],
  origin?: ToolInvocationContext['origin'],
): ScheduleJobCreator {
  const chat = origin?.kind === 'im' && origin.conversation
    ? creatorChat({ conversation: origin.conversation, endpointId: origin.endpoint })
    : undefined;
  return {
    userId: principal.subjectId,
    roles: creatorRoles(principal.roles),
    name: principal.displayName,
    ...(chat ? { chat } : {}),
  };
}

/** 解析持久化 / RPC 传入的 createdBy */
export function parseScheduleJobCreator(raw: unknown): ScheduleJobCreator | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const userId = record.userId != null ? String(record.userId) : '';
  if (!userId) return undefined;
  const chat = creatorChat(record.chat);
  return {
    userId,
    roles: creatorRoles(Array.isArray(record.roles) ? record.roles : []),
    name: record.name != null ? String(record.name) : undefined,
    ...(chat ? { chat } : {}),
  };
}

/** Current chat role facts of a sender (`PermissionHost.currentSenderRoles`). */
export type ScheduleCreatorRoleLookup = (source: unknown) => Readonly<{ chatRole?: ChatRole; chatRoleLevels?: unknown }> | undefined;

/**
 * ADR 0056 §5: a due run uses the creator's **current** role, not the one captured at creation —
 * a revoked owner's jobs stop running with owner trust. Host trust as for a live turn (`owner`
 * only for a global owner). A creator whose address no longer resolves runs as `user` (fail
 * closed). Without an address (jobs created outside IM, or before this was recorded) or without a
 * lookup the captured roles stay.
 */
export function currentScheduleCreator(
  creator: ScheduleJobCreator | undefined,
  lookup: ScheduleCreatorRoleLookup | undefined,
): ScheduleJobCreator | undefined {
  if (!creator?.chat || !lookup) return creator;
  let facts: ReturnType<ScheduleCreatorRoleLookup>;
  try {
    facts = lookup({ conversation: creator.chat.conversation, endpointId: creator.chat.endpointId, sender: { id: creator.userId } });
  } catch {
    facts = undefined;
  }
  if (!facts) return { ...creator, roles: ['user'] };
  const role = hostChatRole(facts);
  return { ...creator, roles: role ? [...expandChatRole(role)] : ['user'] };
}
