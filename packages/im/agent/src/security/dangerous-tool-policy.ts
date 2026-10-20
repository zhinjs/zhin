import { hasSenderRole, senderRolesFromMessage, type Message } from '@zhin.js/core';
import { getLogger } from '@zhin.js/logger';

const logger = getLogger('DangerousToolPolicy');
import type { ZhinAgentConfig } from '../config/index.js';
import { checkFileAccess, extractBashReadPaths } from './file-policy.js';
import type { ToolRequesterRole } from './owner-approval-runtime.js';
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

function resolveExecAllowlistFromMessage(commMessage?: Message): string[] {
  const extra = (commMessage as { extra?: { execAllowlist?: string[] } } | undefined)?.extra;
  if (Array.isArray(extra?.execAllowlist) && extra.execAllowlist.length > 0) {
    return extra.execAllowlist.map((v) => String(v)).filter(Boolean);
  }
  return [];
}

function hasMessageIdentity(commMessage?: Message): boolean {
  return Boolean(commMessage?.clientAdapter && commMessage?.endpointId && commMessage?.sender?.id);
}

function resolveRoleFromMessage(commMessage?: Message): {
  role: ToolRequesterRole;
  hasIdentity: boolean;
} {
  const hasIdentity = hasMessageIdentity(commMessage);
  if (!hasIdentity) {
    return { role: 'unknown', hasIdentity: false };
  }

  return {
    role: resolveRoleFromMessageFallback(commMessage!),
    hasIdentity: true,
  };
}

/** host root 不可用时，从 Message.sender 快照或重算角色（测试/降级路径） */
function resolveRoleFromMessageFallback(commMessage: Message): ToolRequesterRole {
  const snapshot = senderRolesFromMessage(commMessage);
  if (hasSenderRole(snapshot, 'master')) return 'master';
  if (hasSenderRole(snapshot, 'trusted')) return 'trusted';
  return 'other';
}

function denyUnidentifiedTool(toolName: string): DangerousToolDecision {
  // 内部细节（身份解析失败）只进 debug 日志，用户消息不暴露策略实现
  logger.debug(`Tool denied: unidentified caller → ${toolName}`);
  return {
    allowed: false,
    role: 'unknown',
    reason: `权限不足：当前策略不允许执行「${toolName}」。`,
  };
}

export function checkFileToolAccess(toolName: FileToolName, commMessage?: Message): DangerousToolDecision {
  const { role, hasIdentity } = resolveRoleFromMessage(commMessage);
  const op = FILE_TOOL_OPERATION[toolName];

  if (role === 'master') {
    return { allowed: true, role };
  }

  if (!hasIdentity) {
    // 无 IM 上下文（直接工具调用、subagent）→ 全权
    return { allowed: true, role: 'master' };
  }

  if (role === 'unknown') {
    if (op === 'read') {
      return { allowed: true, role };
    }
    return denyUnidentifiedTool(toolName);
  }

  if (role === 'trusted') {
    if (op === 'delete') {
      logger.debug(`Tool denied: trusted role cannot delete → ${toolName}`);
      return {
        allowed: false,
        role,
        reason: `权限不足：当前策略不允许执行「${toolName}」。`,
      };
    }
    return { allowed: true, role };
  }

  if (op === 'read') {
    return { allowed: true, role };
  }

  logger.debug(`Tool denied: read-only access for user → ${toolName}`);
  return {
    allowed: false,
    role,
    reason: `权限不足：当前策略不允许执行「${toolName}」。`,
  };
}

export function checkSensitiveFilePathAccess(
  toolName: FileToolName,
  filePath: string,
  commMessage?: Message,
  workspaceDir?: string,
): DangerousToolDecision {
  const base = checkFileAccess(filePath, workspaceDir);
  const { role } = resolveRoleFromMessage(commMessage);
  if (base.allowed) {
    return { allowed: true, role };
  }

    if (role === 'master') {
      return {
        allowed: false,
        needsOwnerApproval: true,
        role,
        reason: `工具「${toolName}」访问敏感路径需二次确认：${base.reason ?? '命中敏感路径策略'}`,
      };
    }

  if (role === 'trusted') {
    return {
      allowed: false,
      needsOwnerApproval: true,
      role,
      reason: `工具「${toolName}」访问敏感路径需 Master 确认：${base.reason ?? '命中敏感路径策略'}`,
    };
  }

  return {
    allowed: false,
    role,
    reason: base.reason ?? `工具「${toolName}」访问敏感路径被拒绝。`,
  };
}

/**
 * bash 只读命令中的目标路径敏感访问检查（与 read_file 对齐）。
 */
export function checkBashSensitiveReadAccess(
  command: string,
  commMessage?: Message,
  workspaceDir?: string,
): DangerousToolDecision {
  const paths = extractBashReadPaths(command);
  if (paths.length === 0) {
    const { role } = resolveRoleFromMessage(commMessage);
    return { allowed: true, role };
  }
  for (const filePath of paths) {
    const decision = checkSensitiveFilePathAccess('read_file', filePath, commMessage, workspaceDir);
    if (!decision.allowed) {
      return {
        ...decision,
        reason: decision.reason?.replace('read_file', 'bash') ?? decision.reason,
      };
    }
  }
  const { role } = resolveRoleFromMessage(commMessage);
  return { allowed: true, role };
}

export function checkDangerousToolAccess(toolName: 'write_file' | 'edit_file' | 'web_fetch', commMessage?: Message): DangerousToolDecision {
  const { role, hasIdentity } = resolveRoleFromMessage(commMessage);

  if (!hasIdentity) {
    // 无 IM 上下文 → 全权
    return { allowed: true, role: 'master' };
  }

  try {
    if (role === 'master') {
      return { allowed: true, role };
    }

    if (role === 'unknown') {
      return denyUnidentifiedTool(toolName);
    }

    if (role === 'trusted') {
      const allowlist = resolveExecAllowlistFromMessage(commMessage);
      if (isAllowlisted(allowlist, toolName)) {
        return { allowed: true, role };
      }
      logger.debug(`工具「${toolName}」不在 execAllowlist，trusted 需 Master 确认后执行`);
      return {
        allowed: false,
        needsOwnerApproval: true,
        role,
        reason: `权限不足：执行「${toolName}」需要 Owner 确认。`,
      };
    }

    if (role === 'other') {
      logger.debug(`工具「${toolName}」为危险操作，仅 master 可直接执行，已拒绝 other 角色`);
      return {
        allowed: false,
        role,
        reason: `权限不足：当前策略不允许执行「${toolName}」。`,
      };
    }

    return denyUnidentifiedTool(toolName);
  } catch {
    return denyUnidentifiedTool(toolName);
  }
}

export function toOwnerSignal(decision: DangerousToolDecision): string {
  return `ZHIN_NEEDS_OWNER:\n${decision.reason ?? '该操作需要 Master 确认。'}`;
}

export function toDenyError(decision: DangerousToolDecision): string {
  return `Error: ${decision.reason ?? '该操作已被拒绝。'}`;
}

export function isToolAllowlistedByConfig(toolName: string, config: Required<ZhinAgentConfig>): boolean {
  const allowlist = config.execAllowlist ?? [];
  return isAllowlisted(allowlist, toolName);
}
