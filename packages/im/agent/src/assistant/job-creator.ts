import { isFrameworkSenderRole, type SenderRole } from '@zhin.js/core';
import type { ToolInvocationContext } from '@zhin.js/tool';
import type { ScheduleJobCreator } from './types.js';

/** Capture a persisted creator only from the authenticated invocation principal. */
export function scheduleJobCreatorFromPrincipal(
  principal: ToolInvocationContext['principal'],
): ScheduleJobCreator {
  const roles = principal.roles.filter(isFrameworkSenderRole);
  return {
    userId: principal.subjectId,
    roles: roles.length > 0 ? roles : (['user'] as SenderRole[]),
    name: principal.displayName,
  };
}

/** 解析持久化 / RPC 传入的 createdBy */
export function parseScheduleJobCreator(raw: unknown): ScheduleJobCreator | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const userId = record.userId != null ? String(record.userId) : '';
  if (!userId) return undefined;
  const roles = Array.isArray(record.roles)
    ? record.roles.map((r) => String(r)).filter(isFrameworkSenderRole)
    : [];
  return {
    userId,
    roles: (roles.length > 0 ? roles : ['user']) as SenderRole[],
    name: record.name != null ? String(record.name) : undefined,
  };
}
