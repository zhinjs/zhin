import { getHostRootPlugin, getLogger, hasSenderRole, resolveSubjectRoles, senderRolesFromMessage, type Message, type Plugin } from '@zhin.js/core';

const logger = getLogger('DangerousToolPolicy');
import type { ZhinAgentConfig } from '../config/index.js';
import { checkFileAccess, extractBashReadPaths } from './file-policy.js';
import { resolveToolRequesterRole, type ToolRequesterRole } from './owner-approve-always-store.js';
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

function resolveExecAllowlistFromAiService(plugin: Plugin): string[] {
  const root = plugin.root ?? plugin;
  const aiService = root.inject('ai') as { getAgentConfig?: () => { execAllowlist?: string[] } } | undefined;
  const allowlist = aiService?.getAgentConfig?.()?.execAllowlist;
  if (!Array.isArray(allowlist)) return [];
  return allowlist.map((v) => String(v)).filter(Boolean);
}

function resolveExecAllowlistFromMessage(commMessage?: Message): string[] {
  const extra = (commMessage as { extra?: { execAllowlist?: string[] } } | undefined)?.extra;
  if (Array.isArray(extra?.execAllowlist) && extra.execAllowlist.length > 0) {
    return extra.execAllowlist.map((v) => String(v)).filter(Boolean);
  }
  return [];
}

/** 优先 message.extra，再尝试 host root 读取 ai.agent.execAllowlist */
function resolveExecAllowlistSafe(
  plugin: Plugin | undefined,
  commMessage?: Message,
): string[] {
  const fromExtra = resolveExecAllowlistFromMessage(commMessage);
  if (fromExtra.length > 0) return fromExtra;

  const host = plugin ?? getHostRootPlugin() ?? undefined;
  if (host) {
    const fromPlugin = resolveExecAllowlistFromAiService(host);
    if (fromPlugin.length > 0) return fromPlugin;
  }

  return [];
}

function hasMessageIdentity(commMessage?: Message): boolean {
  return Boolean(commMessage?.$adapter && commMessage?.$endpoint && commMessage?.$sender?.id);
}

function resolveRoleFromMessage(commMessage?: Message): {
  role: ToolRequesterRole;
  plugin?: Plugin;
  hasIdentity: boolean;
} {
  const hasIdentity = hasMessageIdentity(commMessage);
  if (!hasIdentity) {
    return { role: 'unknown', hasIdentity: false };
  }

  const host = getHostRootPlugin();
  if (host) {
    return {
      role: resolveToolRequesterRole(host, commMessage!),
      plugin: host,
      hasIdentity: true,
    };
  }

  return {
    role: resolveRoleFromMessageFallback(commMessage!),
    plugin: undefined,
    hasIdentity: true,
  };
}

/** host root 不可用时，从 Message.$sender 快照或重算角色（测试/降级路径） */
function resolveRoleFromMessageFallback(commMessage: Message): ToolRequesterRole {
  const snapshot = senderRolesFromMessage(commMessage);
  if (commMessage.$sender.isMaster !== undefined || commMessage.$sender.isTrusted !== undefined) {
    if (hasSenderRole(snapshot, 'master')) return 'master';
    if (hasSenderRole(snapshot, 'trusted')) return 'trusted';
    return 'other';
  }
  const host = getHostRootPlugin();
  if (host) {
    const { roles } = resolveSubjectRoles(host, commMessage);
    if (hasSenderRole(roles, 'master')) return 'master';
    if (hasSenderRole(roles, 'trusted')) return 'trusted';
    return 'other';
  }
  return 'unknown';
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

export function checkSensitiveFilePathAccess(toolName: FileToolName, filePath: string, commMessage?: Message): DangerousToolDecision {
  const base = checkFileAccess(filePath);
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
): DangerousToolDecision {
  const paths = extractBashReadPaths(command);
  if (paths.length === 0) {
    const { role } = resolveRoleFromMessage(commMessage);
    return { allowed: true, role };
  }
  for (const filePath of paths) {
    const decision = checkSensitiveFilePathAccess('read_file', filePath, commMessage);
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
  const { role, plugin, hasIdentity } = resolveRoleFromMessage(commMessage);

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
      const allowlist = resolveExecAllowlistSafe(plugin, commMessage);
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
