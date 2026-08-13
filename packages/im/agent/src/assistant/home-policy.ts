/**
 * Home Domain 工具权限（M4）
 */
import type { ToolInvocationContext } from '@zhin.js/tool';
import { type ToolRequesterRole } from '../security/owner-approve-always-store.js';
import type { HomePolicyConfig } from './home-config.js';
import { parseEntityDomain } from './domains/home-entity.js';
export interface HomeToolDecision {
  allowed: boolean;
  needsOwnerApproval?: boolean;
  reason?: string;
  role: ToolRequesterRole;
}

export type HomePrincipal = ToolInvocationContext['principal'];

function resolveRole(principal: HomePrincipal): ToolRequesterRole {
  if (principal.roles.includes('master')) return 'master';
  if (principal.roles.includes('trusted')) return 'trusted';
  return 'other';
}

export function checkHomeToolAccess(
  operation: 'read' | 'write',
  entityId: string,
  principal: HomePrincipal,
  policy: HomePolicyConfig & { requireMaster: boolean; confirmServices: string[] },
): HomeToolDecision {
  const role = resolveRole(principal);
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
