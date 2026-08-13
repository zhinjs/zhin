import {
  hasSenderRole,
  isFrameworkSenderRole,
  type SenderRole,
} from '@zhin.js/core';
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

/** 将持久化的创建者转为合成 Message 的 sender 快照（供 harness 角色判定） */
export function senderFromScheduleCreator(creator: ScheduleJobCreator): {
  id: string;
  name: string;
  isMaster: boolean;
  isTrusted: boolean;
} {
  const isMaster = hasSenderRole(creator.roles, 'master');
  const isTrusted = !isMaster && hasSenderRole(creator.roles, 'trusted');
  return {
    id: creator.userId,
    name: creator.name?.trim() || creator.userId,
    isMaster,
    isTrusted,
  };
}
