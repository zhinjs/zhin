import * as zhinCore from '@zhin.js/core';
import type { Message } from '@zhin.js/core';
import { hasSenderRole, resolveSubjectRoles, senderRolesFromMessage } from '@zhin.js/core';
import type { ZhinAgentConfig } from '../zhin-agent/config.js';
import { resolveToolRequesterRole, type ToolRequesterRole } from './owner-approve-always-store.js';
import { checkFileAccess } from './file-policy.js';

/** 命名空间调用，便于单测 vi.spyOn(core, 'getPlugin') 与实现一致 */
function getPlugin(): zhinCore.Plugin {
  return zhinCore.getPlugin();
}

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

function resolveExecAllowlistFromMessage(commMessage?: Message): string[] {
  const extra = (commMessage as { extra?: { execAllowlist?: string[] } } | undefined)?.extra;
  if (Array.isArray(extra?.execAllowlist) && extra.execAllowlist.length > 0) {
    return extra.execAllowlist.map((v) => String(v)).filter(Boolean);
  }
  return [];
}

/** 优先 message.extra，再尝试 plugin / getPlugin() 读取 ai.agent.execAllowlist */
function resolveExecAllowlistSafe(
  plugin: ReturnType<typeof getPlugin> | undefined,
  commMessage?: Message,
): string[] {
  const fromExtra = resolveExecAllowlistFromMessage(commMessage);
  if (fromExtra.length > 0) return fromExtra;

  if (plugin) {
    const fromPlugin = resolveExecAllowlistFromAiService(plugin);
    if (fromPlugin.length > 0) return fromPlugin;
  }

  try {
    return resolveExecAllowlistFromAiService(getPlugin());
  } catch {
    return [];
  }
}

function hasMessageIdentity(commMessage?: Message): boolean {
  return Boolean(commMessage?.$adapter && commMessage?.$endpoint && commMessage?.$sender?.id);
}

function resolveRoleFromMessage(commMessage?: Message): {
  role: ToolRequesterRole;
  plugin?: ReturnType<typeof getPlugin>;
  hasIdentity: boolean;
} {
  const hasIdentity = hasMessageIdentity(commMessage);
  if (!hasIdentity) {
    return { role: 'unknown', hasIdentity: false };
  }
  try {
    const plugin = getPlugin();
    return {
      role: resolveToolRequesterRole(plugin, commMessage!),
      plugin,
      hasIdentity: true,
    };
  } catch {
    let plugin: ReturnType<typeof getPlugin> | undefined;
    try {
      plugin = getPlugin();
    } catch {
      plugin = undefined;
    }
    return {
      role: resolveRoleFromMessageFallback(commMessage!),
      plugin,
      hasIdentity: true,
    };
  }
}

/** getPlugin 不可用时，从 Message.$sender 快照或重算角色（测试/降级路径） */
function resolveRoleFromMessageFallback(commMessage: Message): ToolRequesterRole {
  const snapshot = senderRolesFromMessage(commMessage);
  if (commMessage.$sender.isMaster !== undefined || commMessage.$sender.isTrusted !== undefined) {
    if (hasSenderRole(snapshot, 'master')) return 'master';
    if (hasSenderRole(snapshot, 'trusted')) return 'trusted';
    return 'other';
  }
  try {
    const { roles } = resolveSubjectRoles(getPlugin().root ?? getPlugin(), commMessage);
    if (hasSenderRole(roles, 'master')) return 'master';
    if (hasSenderRole(roles, 'trusted')) return 'trusted';
    return 'other';
  } catch {
    return 'unknown';
  }
}

function denyUnidentifiedTool(toolName: string): DangerousToolDecision {
  return {
    allowed: false,
    role: 'unknown',
    reason: `无法确认调用者身份：工具「${toolName}」已拒绝。`,
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
      return {
        allowed: false,
        role,
        reason: `trusted 无删除权限：工具「${toolName}」已拒绝。`,
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
      return {
        allowed: false,
        needsOwnerApproval: true,
        role,
        reason: `工具「${toolName}」不在 execAllowlist，trusted 需 Master 确认后执行。`,
      };
    }

    if (role === 'other') {
      return {
        allowed: false,
        role,
        reason: `工具「${toolName}」为危险操作，仅 master 可直接执行；trusted 需 Master 审批。`,
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
