/**
 * Home Domain 工具权限（M4）
 */
import { getPlugin } from '@zhin.js/core';
import type { ToolContext } from '@zhin.js/core';
import {
  resolveToolRequesterRole,
  type ToolRequesterRole,
} from '../security/owner-approve-always-store.js';
import type { HomePolicyConfig } from './home-config.js';
import { parseEntityDomain } from './domains/home-assistant.js';

export interface HomeToolDecision {
  allowed: boolean;
  needsOwnerApproval?: boolean;
  reason?: string;
  role: ToolRequesterRole;
}

function resolveRole(context?: ToolContext): ToolRequesterRole {
  if (!context?.platform || !context?.botId || !context?.senderId) {
    return 'unknown';
  }
  try {
    return resolveToolRequesterRole(getPlugin(), context);
  } catch {
    if (context.roles?.includes('master')) return 'master';
    return 'other';
  }
}

export function checkHomeToolAccess(
  operation: 'read' | 'write',
  entityId: string,
  context: ToolContext | undefined,
  policy: HomePolicyConfig & { requireMaster: boolean; confirmServices: string[] },
): HomeToolDecision {
  const role = resolveRole(context);
  const domain = parseEntityDomain(entityId);

  if (policy.requireMaster && role !== 'master') {
    return {
      allowed: false,
      role,
      reason: '智能家居操作仅允许 Bot Owner（master）调用。',
    };
  }

  if (operation === 'write' && policy.confirmServices.includes(domain)) {
    return {
      allowed: false,
      needsOwnerApproval: true,
      role,
      reason: `「${domain}」类设备操作需 Owner 确认后方可执行（entity: ${entityId}）。`,
    };
  }

  return { allowed: true, role };
}

export function toHomeOwnerSignal(decision: HomeToolDecision): string {
  return `ZHIN_NEEDS_OWNER:\n${decision.reason ?? '该智能家居操作需要 Master 确认。'}`;
}

export function toHomeDenyError(decision: HomeToolDecision): string {
  return `Error: ${decision.reason ?? '智能家居操作被拒绝。'}`;
}
