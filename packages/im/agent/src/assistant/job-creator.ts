import { isChatRole, type ChatRole } from '@zhin.js/core';
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

/** Capture a persisted creator only from the authenticated invocation principal. */
export function scheduleJobCreatorFromPrincipal(
  principal: ToolInvocationContext['principal'],
): ScheduleJobCreator {
  return {
    userId: principal.subjectId,
    roles: creatorRoles(principal.roles),
    name: principal.displayName,
  };
}

/** 解析持久化 / RPC 传入的 createdBy */
export function parseScheduleJobCreator(raw: unknown): ScheduleJobCreator | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const userId = record.userId != null ? String(record.userId) : '';
  if (!userId) return undefined;
  return {
    userId,
    roles: creatorRoles(Array.isArray(record.roles) ? record.roles : []),
    name: record.name != null ? String(record.name) : undefined,
  };
}
