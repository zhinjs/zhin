import { getPlugin } from '@zhin.js/core';
import type { ToolContext } from '@zhin.js/core';
import type { ZhinAgentConfig } from '../zhin-agent/config.js';
import { resolveToolRequesterRole, type ToolRequesterRole } from './owner-approve-always-store.js';
import { checkFileAccess } from './file-policy.js';

export interface DangerousToolDecision {
  allowed: boolean;
  needsOwnerApproval?: boolean;
  reason?: string;
  role: ToolRequesterRole;
}

export type FileToolName = 'read_file' | 'list_dir' | 'glob' | 'grep' | 'write_file' | 'edit_file';

type FileOperation = 'read' | 'write' | 'delete';

const FILE_TOOL_OPERATION: Record<FileToolName, FileOperation> = {
  read_file: 'read',
  list_dir: 'read',
  glob: 'read',
  grep: 'read',
  write_file: 'write',
  edit_file: 'write',
};

function isAllowlisted(allowlist: string[], item: string): boolean {
  return allowlist.some((pattern) => {
    try {
      const re = new RegExp(`^${pattern}$`);
      return re.test(item);
    } catch {
      return item === pattern;
    }
  });
}

function resolveExecAllowlistFromAiService(plugin: ReturnType<typeof getPlugin>): string[] {
  const root = plugin.root ?? plugin;
  const aiService = root.inject('ai') as { getAgentConfig?: () => { execAllowlist?: string[] } } | undefined;
  const allowlist = aiService?.getAgentConfig?.()?.execAllowlist;
  if (!Array.isArray(allowlist)) return [];
  return allowlist.map((v) => String(v)).filter(Boolean);
}

function hasToolIdentity(context?: ToolContext): boolean {
  return Boolean(context?.platform && context?.botId && context?.senderId);
}

function resolveRoleFromContext(context?: ToolContext): {
  role: ToolRequesterRole;
  plugin?: ReturnType<typeof getPlugin>;
  hasIdentity: boolean;
} {
  const hasIdentity = hasToolIdentity(context);
  if (!hasIdentity) {
    return { role: 'unknown', hasIdentity: false };
  }
  try {
    const plugin = getPlugin();
    return {
      role: resolveToolRequesterRole(plugin, context!),
      plugin,
      hasIdentity: true,
    };
  } catch {
    return {
      role: resolveRoleFromToolContextFallback(context!),
      hasIdentity: true,
    };
  }
}

/** getPlugin 不可用时，从 ToolContext 上的 IM 标记推断角色（测试/降级路径） */
function resolveRoleFromToolContextFallback(context: ToolContext): ToolRequesterRole {
  if (context.isOwner === true) return 'owner';
  if (context.isBotAdmin === true) return 'admin';
  if (context.fileRole === 'owner') return 'owner';
  if (context.fileRole === 'admin') return 'admin';
  if (context.fileRole === 'user') return 'other';
  return 'unknown';
}

function denyUnidentifiedTool(toolName: string): DangerousToolDecision {
  return {
    allowed: false,
    role: 'unknown',
    reason: `无法确认调用者身份：工具「${toolName}」已拒绝。`,
  };
}

export function checkFileToolAccess(toolName: FileToolName, context?: ToolContext): DangerousToolDecision {
  const { role, hasIdentity } = resolveRoleFromContext(context);
  const op = FILE_TOOL_OPERATION[toolName];

  if (role === 'owner') {
    return { allowed: true, role };
  }

  if (!hasIdentity) {
    return { allowed: true, role: 'unknown' };
  }

  if (role === 'unknown') {
    if (op === 'read') {
      return { allowed: true, role };
    }
    return denyUnidentifiedTool(toolName);
  }

  if (role === 'admin') {
    if (op === 'delete') {
      return {
        allowed: false,
        role,
        reason: `admin 无删除权限：工具「${toolName}」已拒绝。`,
      };
    }
    return { allowed: true, role };
  }

  if (op === 'read') {
    return { allowed: true, role };
  }

  return {
    allowed: false,
    role,
    reason: `普通用户仅允许查询（读），无增删改权限：工具「${toolName}」已拒绝。`,
  };
}

export function checkSensitiveFilePathAccess(toolName: FileToolName, filePath: string, context?: ToolContext): DangerousToolDecision {
  const base = checkFileAccess(filePath);
  const { role } = resolveRoleFromContext(context);
  if (base.allowed) {
    return { allowed: true, role };
  }

  if (role === 'owner') {
    return {
      allowed: false,
      needsOwnerApproval: true,
      role,
      reason: `工具「${toolName}」访问敏感路径需二次确认：${base.reason ?? '命中敏感路径策略'}`,
    };
  }

  if (role === 'admin') {
    return {
      allowed: false,
      needsOwnerApproval: true,
      role,
      reason: `工具「${toolName}」访问敏感路径需 Owner 确认：${base.reason ?? '命中敏感路径策略'}`,
    };
  }

  return {
    allowed: false,
    role,
    reason: base.reason ?? `工具「${toolName}」访问敏感路径被拒绝。`,
  };
}

export function checkDangerousToolAccess(toolName: 'write_file' | 'edit_file' | 'web_fetch', context?: ToolContext): DangerousToolDecision {
  const { role, plugin, hasIdentity } = resolveRoleFromContext(context);

  if (!hasIdentity) {
    return { allowed: true, role: 'unknown' };
  }

  try {
    if (role === 'owner') {
      return { allowed: true, role };
    }

    if (role === 'unknown') {
      return denyUnidentifiedTool(toolName);
    }

    if (role === 'admin') {
      const allowlist = plugin ? resolveExecAllowlistFromAiService(plugin) : [];
      if (isAllowlisted(allowlist, toolName)) {
        return { allowed: true, role };
      }
      return {
        allowed: false,
        needsOwnerApproval: true,
        role,
        reason: `工具「${toolName}」不在 execAllowlist，admin 需 Owner 确认后执行。`,
      };
    }

    if (role === 'other') {
      return {
        allowed: false,
        role,
        reason: `工具「${toolName}」为危险操作，仅 owner 可直接执行；admin 需 Owner 审批。`,
      };
    }

    return denyUnidentifiedTool(toolName);
  } catch {
    return denyUnidentifiedTool(toolName);
  }
}

export function toOwnerSignal(decision: DangerousToolDecision): string {
  return `ZHIN_NEEDS_OWNER:\n${decision.reason ?? '该操作需要 Owner 确认。'}`;
}

export function toDenyError(decision: DangerousToolDecision): string {
  return `Error: ${decision.reason ?? '该操作已被拒绝。'}`;
}

export function isToolAllowlistedByConfig(toolName: string, config: Required<ZhinAgentConfig>): boolean {
  const allowlist = config.execAllowlist ?? [];
  return isAllowlisted(allowlist, toolName);
}
