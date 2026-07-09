import {
  hasSenderRole,
  isFrameworkSenderRole,
  senderRolesFromMessage,
  type Message,
  type SenderRole,
} from '@zhin.js/core';
import type { ScheduleJobCreator } from './types.js';

/** 从入站 Message 捕获调度任务创建者（schedule_add / 对话内创建） */
export function captureScheduleJobCreator(message?: Message): ScheduleJobCreator | undefined {
  const senderId = message?.$sender?.id;
  if (senderId == null || String(senderId).length === 0) return undefined;
  const roles = [...senderRolesFromMessage(message)];
  return {
    userId: String(senderId),
    roles: roles.length > 0 ? roles : (['user'] as SenderRole[]),
    name:
      message?.$sender.name
      ?? (message?.$sender as { nickname?: string }).nickname
      ?? undefined,
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
