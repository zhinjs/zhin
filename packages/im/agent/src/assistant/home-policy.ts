/**
 * Home Domain 工具权限（M4）
 */
import {
  getPlugin,
  hasSenderRole,
  mergeAITriggerConfig,
  resolveSenderRoles,
  senderRolesFromMessage,
} from '@zhin.js/core';
import type { Message } from '@zhin.js/core';
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

function resolveRole(commMessage?: Message): ToolRequesterRole {
  if (!commMessage?.$adapter || !commMessage?.$endpoint || !commMessage?.$sender?.id) {
    return 'unknown';
  }
  if (commMessage.$adapter === 'process') return 'master';
  try {
    return resolveToolRequesterRole(getPlugin(), commMessage);
  } catch {
    if (commMessage.$sender.isMaster !== undefined || commMessage.$sender.isTrusted !== undefined) {
      const roles = senderRolesFromMessage(commMessage);
      if (hasSenderRole(roles, 'master')) return 'master';
      if (hasSenderRole(roles, 'trusted')) return 'trusted';
      return 'other';
    }
    try {
      const { roles } = resolveSenderRoles(
        commMessage,
        mergeAITriggerConfig({}),
        undefined,
      );
      if (hasSenderRole(roles, 'master')) return 'master';
      if (hasSenderRole(roles, 'trusted')) return 'trusted';
      return 'other';
    } catch {
      return 'other';
    }
  }
}

export function checkHomeToolAccess(
  operation: 'read' | 'write',
  entityId: string,
  commMessage: Message | undefined,
  policy: HomePolicyConfig & { requireMaster: boolean; confirmServices: string[] },
): HomeToolDecision {
  const role = resolveRole(commMessage);
  const domain = parseEntityDomain(entityId);

  if (policy.requireMaster && role !== 'master') {
    return {
      allowed: false,
      role,
      reason: '智能家居操作仅允许 Endpoint Owner（master）调用。',
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
