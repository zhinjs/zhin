/**
 * 文件操作角色权限策略
 *
 * 三级文件操作角色:
 *  - owner:  增删改查（CRUD），敏感/危险操作需二次确认
 *  - admin:  增改查（CRU），无删权限；敏感/危险操作需 Owner 确认
 *  - user:   只查（R），敏感/危险操作直接拒绝
 *
 * 权限矩阵:
 *  ┌──────────┬───────┬───────┬───────┬───────┐
 *  │ 操作     │ owner │ admin │ user  │
 *  ├──────────┼───────┼───────┼───────┤
 *  │ create   │  ✅   │  ✅   │  ❌   │
 *  │ read     │  ✅   │  ✅   │  ✅   │
 *  │ update   │  ✅   │  ✅   │  ❌   │
 *  │ delete   │  ✅   │  ❌   │  ❌   │
 *  └──────────┴───────┴───────┴───────┘
 *
 * 敏感/危险判定:
 *  - owner + 危险 → needsConfirmation（自我二次确认）
 *  - admin + 危险 → needsOwnerConfirmation（需 Owner 确认）
 *  - user  + 危险 → 直接拒绝
 */

// ── 类型定义 ──────────────────────────────────────────────────────

/**
 * 文件操作角色
 */
export type FileRole = 'owner' | 'admin' | 'user';

/**
 * 文件操作类型
 */
export type FileOperation = 'create' | 'read' | 'update' | 'delete';

/**
 * 文件权限检查结果
 */
export interface FilePermissionResult {
  /** 操作是否被允许 */
  allowed: boolean;
  /** 拒绝原因 */
  reason?: string;
  /** 需要二次确认（owner 场景） */
  needsConfirmation?: boolean;
  /** 需要 Owner 确认（admin 场景） */
  needsOwnerConfirmation?: boolean;
  /** 当前角色 */
  role: FileRole;
  /** 请求的操作 */
  operation: FileOperation;
}

// ── 权限矩阵 ──────────────────────────────────────────────────────

const FILE_PERMISSION_MATRIX: Record<FileRole, Record<FileOperation, boolean>> = {
  owner: { create: true, read: true, update: true, delete: true },
  admin: { create: true, read: true, update: true, delete: false },
  user: { create: false, read: true, update: false, delete: false },
};

// ── 敏感/危险文件路径判定 ──────────────────────────────────────────

/**
 * 危险文件路径模式 — 覆盖系统配置、密钥、数据库等关键位置。
 * 对 owner 仍允许操作但需二次确认；对 admin 需 Owner 确认；对 user 直接拒绝。
 */
const DANGEROUS_PATH_PATTERNS: RegExp[] = [
  /\/etc\/passwd/i,
  /\/etc\/shadow/i,
  /\/etc\/hosts/i,
  /\/etc\/sudoers/i,
  /\.env(\..*)?$/i,
  /\.ssh\//i,
  /\.gnupg\//i,
  /\.aws\//i,
  /\.kube\//i,
  /\.config\/gcloud\//i,
  /\.docker\//i,
  /\.git\//i,
  /\/package\.json$/i,
  /\/pnpm-lock\.yaml$/i,
  /\/yarn\.lock$/i,
  /\/tsconfig\.json$/i,
  /\.pem$/i,
  /\.key$/i,
];

/**
 * 危险删除命令关键词 — 使用 bash 执行文件删除时匹配。
 */
const DANGEROUS_DELETE_COMMANDS: RegExp[] = [
  /\brm\s+/i,
  /\brmdir\b/i,
  /\bunlink\b/i,
  /\brm\s*-\w*r/i,
  /\bshred\b/i,
  /\btruncate\b/i,
];

/**
 * 交互式/危险命令关键词 — 使用 bash 执行写入类操作时匹配。
 */
const DANGEROUS_WRITE_COMMANDS: RegExp[] = [
  /\bdd\s+/i,
  /\bmkfs\b/i,
  /\bformat\b/i,
  /\bfdisk\b/i,
];

// ── 核心检查函数 ──────────────────────────────────────────────────

/**
 * 检查文件操作权限
 *
 * @param role 当前用户角色
 * @param operation 请求的文件操作类型
 * @param filePath 操作涉及的文件路径（用于危险判定）
 * @returns 权限结果
 */
export function checkFilePermission(
  role: FileRole,
  operation: FileOperation,
  filePath?: string,
): FilePermissionResult {
  const allowed = FILE_PERMISSION_MATRIX[role][operation];

  if (!allowed) {
    const reason = role === 'user'
      ? `当前角色为「普通用户」，仅允许读取文件；请求的操作「${operation}」被拒绝。`
      : role === 'admin' && operation === 'delete'
        ? `当前角色为「管理员」，不允许删除文件；请联系 Owner 执行删除操作。`
        : `当前角色「${role}」无权执行「${operation}」操作。`;
    return {
      allowed: false,
      reason,
      role,
      operation,
    };
  }

  const isDangerous = operation === 'delete' || (filePath ? isDangerousFileOperation(operation, filePath) : false);

  if (isDangerous) {
    if (role === 'owner') {
      return {
        allowed: true,
        needsConfirmation: true,
        reason: filePath
          ? `对敏感路径「${filePath}」执行「${operation}」操作需要二次确认。`
          : `「${operation}」操作需要二次确认。`,
        role,
        operation,
      };
    }
    if (role === 'admin') {
      return {
        allowed: true,
        needsOwnerConfirmation: true,
        reason: filePath
          ? `管理员对敏感路径「${filePath}」执行「${operation}」操作需要 Owner 确认。`
          : `管理员执行「${operation}」操作需要 Owner 确认。`,
        role,
        operation,
      };
    }
  }

  return { allowed: true, role, operation };
}

/**
 * 判断文件操作是否为危险操作
 *
 * 危险判定规则:
 *  - delete 操作始终视为危险
 *  - create/update 操作对敏感路径视为危险
 *  - read 操作通常不视为危险
 */
export function isDangerousFileOperation(operation: FileOperation, filePath: string): boolean {
  if (operation === 'delete') return true;

  if (operation === 'create' || operation === 'update') {
    return DANGEROUS_PATH_PATTERNS.some(p => p.test(filePath));
  }

  return false;
}

/**
 * 从 ToolPermissionLevel / 权限标志推导 FileRole
 *
 * 映射规则:
 *  - isOwner → 'owner'
 *  - isBotAdmin / isGroupOwner / isGroupAdmin → 'admin'
 *  - 其余 → 'user'
 */
export function inferFileRole(context: {
  isOwner?: boolean;
  isBotAdmin?: boolean;
  isGroupOwner?: boolean;
  isGroupAdmin?: boolean;
  senderPermissionLevel?: string;
}): FileRole {
  if (context.isOwner) return 'owner';

  if (context.senderPermissionLevel === 'owner') return 'owner';
  if (context.senderPermissionLevel === 'bot_admin') return 'admin';
  if (context.senderPermissionLevel === 'group_owner') return 'admin';
  if (context.senderPermissionLevel === 'group_admin') return 'admin';

  if (context.isBotAdmin || context.isGroupOwner || context.isGroupAdmin) return 'admin';

  return 'user';
}

/**
 * 从 ToolRequesterRole（dangerous-tool-policy 推导出的角色）转换为 FileRole
 *
 * 映射规则:
 *  - 'owner' → 'owner'
 *  - 'admin' → 'admin'
 *  - 'other' → 'user'
 *  - 'unknown' → 'owner'（无上下文时默认最高权限，向后兼容）
 */
export function toolRequesterRoleToFileRole(role: 'owner' | 'admin' | 'other' | 'unknown'): FileRole {
  switch (role) {
    case 'owner': return 'owner';
    case 'admin': return 'admin';
    case 'other': return 'user';
    case 'unknown': return 'owner';
  }
}

/**
 * 将 bash 命令分类为文件操作类型
 * 返回 null 表示非文件操作命令（如纯查询命令）。
 */
export function classifyBashFileOperation(command: string): FileOperation | null {
  const trimmed = command.trim();
  const baseCmd = trimmed.split(/\s+/)[0] || '';

  if (DANGEROUS_DELETE_COMMANDS.some(p => p.test(trimmed))) return 'delete';

  const writeCommands = ['tee', 'sed', 'awk', 'perl', 'python', 'python3', 'node', 'bash', 'sh', 'zsh', 'fish', 'npm', 'npx', 'pnpm', 'yarn', 'git', 'curl', 'wget', 'cp', 'mv', 'install', 'pip', 'pip3', 'cargo', 'make', 'docker'];
  if (writeCommands.includes(baseCmd)) return 'update';

  if (/[>|]\s/i.test(trimmed) || /\btee\b/i.test(trimmed)) return 'update';

  if ((/\bmkdir\b/i.test(trimmed) || /\btouch\b/i.test(trimmed)) && !/\brm\b/i.test(trimmed)) return 'create';

  const readCommands = ['cat', 'head', 'tail', 'less', 'more', 'wc', 'stat', 'file', 'ls', 'find', 'grep', 'rg', 'ag', 'ack', 'which', 'whereis', 'echo', 'printf', 'sort', 'uniq', 'tr', 'cut', 'jq'];
  if (readCommands.includes(baseCmd)) return 'read';

  return null;
}

/**
 * 检查 bash 命令的文件操作权限
 *
 * 结合 bash 命令分类与文件角色权限，返回权限检查结果。
 * 若命令不涉及文件操作（如纯进程查询），直接放行。
 */
export function checkBashFilePermission(
  role: FileRole,
  command: string,
): FilePermissionResult & { fileOperation: FileOperation | null } {
  const fileOp = classifyBashFileOperation(command);

  if (fileOp === null) {
    return {
      allowed: true,
      role,
      operation: 'read',
      fileOperation: null,
    };
  }

  const result = checkFilePermission(role, fileOp);
  return { ...result, fileOperation: fileOp };
}

/**
 * 根据 FilePermissionResult 生成 ZHIN_NEEDS_OWNER 信号消息
 *
 * 用于与现有 Owner 确认编排机制集成:
 *  - needsConfirmation → 生成需要确认的消息
 *  - needsOwnerConfirmation → 生成需要 Owner 确认的消息
 *  - !allowed → 直接拒绝消息
 */
export function formatFilePermissionMessage(result: FilePermissionResult, toolName: string, detail?: string): string {
  if (!result.allowed) {
    return `Error: ${result.reason}`;
  }
  if (result.needsOwnerConfirmation) {
    const body = detail || result.reason || `文件操作「${result.operation}」需要 Owner 确认`;
    return `ZHIN_NEEDS_OWNER:\n${body}\n\n（管理员执行敏感文件操作需 Owner 确认；请 Owner 回复确认或拒绝。）`;
  }
  if (result.needsConfirmation) {
    const body = detail || result.reason || `文件操作「${result.operation}」需要二次确认`;
    return `ZHIN_NEEDS_OWNER:\n${body}\n\n（Owner 对敏感路径执行操作需二次确认；请确认继续或拒绝。）`;
  }
  return '';
}

/**
 * 生成角色感知的提示词片段 — 供 system prompt 注入
 */
export function buildFileRolePrompt(role: FileRole): string {
  const roleLabels: Record<FileRole, string> = {
    owner: 'Owner（拥有者）',
    admin: 'Admin（管理员）',
    user: 'User（普通用户）',
  };

  const permissions: Record<FileRole, string> = {
    owner: '你拥有完整的文件操作权限（创建、读取、修改、删除），但对敏感路径的操作需要二次确认。',
    admin: '你可以创建、读取、修改文件，但不能删除文件。对敏感路径的操作需要 Owner 确认。',
    user: '你只能读取文件，不能创建、修改或删除任何文件。',
  };

  return [
    `当前用户角色: ${roleLabels[role]}`,
    permissions[role],
    role === 'owner'
      ? '作为 Owner，删除文件和修改敏感配置时请务必确认操作的必要性。'
      : role === 'admin'
        ? '作为 Admin，如需删除文件请联系 Owner 确认。修改敏感文件同样需要 Owner 授权。'
        : '作为普通用户，如需修改文件请联系管理员或 Owner。',
  ].join('\n');
}