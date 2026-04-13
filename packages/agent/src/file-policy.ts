/**
 * 文件访问安全策略
 *
 * 防止 AI Agent 读写敏感文件（如 .env、密钥、证书等），
 * 并将 bash/grep/glob 等工具的命令注入风险降到最低。
 *
 * 四层防御:
 *  1. 设备路径阻止 — 阻止 /dev/zero, /dev/stdin 等挂起进程的设备文件
 *  2. 敏感文件名/路径模式 — 阻止 .env、私钥、证书等
 *  3. 敏感目录 — 阻止 .ssh, .gnupg 等
 *  4. bash 安全分类 — 环境变量泄漏 + 命令读写分类
 */

import * as path from 'path';
import * as os from 'os';

// ── 设备路径阻止（参考 Claude Code FileReadTool BLOCKED_DEVICE_PATHS）──

/**
 * 会导致进程挂起的设备文件路径。
 * 检查纯路径即可（无 I/O），安全设备如 /dev/null 不在此列。
 */
const BLOCKED_DEVICE_PATHS: ReadonlySet<string> = new Set([
  // 无限输出 — 永远无法 EOF
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/full',
  // 阻塞等待输入
  '/dev/stdin',
  '/dev/tty',
  '/dev/console',
  // 对读取无意义
  '/dev/stdout',
  '/dev/stderr',
  // stdio fd 别名
  '/dev/fd/0',
  '/dev/fd/1',
  '/dev/fd/2',
]);

/**
 * 检测路径是否为被阻止的设备文件（含 Linux /proc/ fd 别名）。
 */
export function isBlockedDevicePath(filePath: string): boolean {
  if (BLOCKED_DEVICE_PATHS.has(filePath)) return true;
  // /proc/self/fd/0-2 和 /proc/<pid>/fd/0-2 是 Linux 的 stdio 别名
  if (
    filePath.startsWith('/proc/') &&
    (filePath.endsWith('/fd/0') || filePath.endsWith('/fd/1') || filePath.endsWith('/fd/2'))
  ) return true;
  return false;
}

// ── 文件大小限制（参考 Claude Code FileEditTool MAX_EDIT_FILE_SIZE）──

/** 读取文件最大字节数（256 MiB），防止 OOM */
export const MAX_READ_FILE_SIZE = 256 * 1024 * 1024;
/** 编辑文件最大字节数（1 GiB），防止 V8 字符串长度溢出 */
export const MAX_EDIT_FILE_SIZE = 1024 * 1024 * 1024;

// ── 敏感文件名模式 ──────────────────────────────────────────────────

/**
 * 匹配文件基名（不含目录）的敏感模式。
 * 大小写不敏感匹配。
 */
const SENSITIVE_BASENAME_PATTERNS: RegExp[] = [
  // 环境变量文件
  /^\.env(\..*)?$/i,  
  /^\.zhin\.config(\..*)?$/i,                      // .env, .env.local, .env.production 等
  // 密钥 / 证书
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /\.keystore$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /^id_ecdsa$/i,
  /^id_dsa$/i,
  // 凭据文件
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /^\.docker\/config\.json$/i,
  /^credentials$/i,
  /^credentials\.json$/i,
  /^service[_-]?account.*\.json$/i,
  /^token\.json$/i,
  // 数据库 / 密码文件
  /^\.pgpass$/i,
  /^\.my\.cnf$/i,
  /^\.passwd$/i,
  // 历史文件（可能含输入的密码等）
  /^\.bash_history$/i,
  /^\.zsh_history$/i,
  /^\.node_repl_history$/i,
  /^\.python_history$/i,
];

/**
 * 被完全禁止访问的目录名（在路径中任何位置出现即拦截）。
 */
const SENSITIVE_DIR_NAMES: ReadonlySet<string> = new Set([
  '.ssh',
  '.gnupg',
  '.gpg',
  '.aws',
  '.azure',
  'data',
  '.gcloud',
  '.config/gcloud',
  '.kube',
]);

/**
 * 被禁止访问的绝对路径前缀（系统级敏感目录）。
 */
const SENSITIVE_PATH_PREFIXES: string[] = [
  '/etc/shadow',
  '/etc/gshadow',
  '/etc/ssl/private',
];

// ── 核心检查函数 ────────────────────────────────────────────────────

export interface FileAccessCheckResult {
  allowed: boolean;
  reason?: string;
}

function expandHome(filePath: string): string {
  return filePath.replace(/^~(?=$|[\\/])/, os.homedir());
}

function normalizePathSeparators(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function getPolicyPathCandidates(filePath: string): string[] {
  const expanded = expandHome(filePath);
  const raw = normalizePathSeparators(expanded);
  const resolved = normalizePathSeparators(path.resolve(expanded));
  return [...new Set([raw, resolved])];
}

/**
 * 检查文件路径是否允许被 AI Agent 访问。
 * 该函数只做「阻止明确敏感文件」的检查，不做正向白名单。
 */
export function checkFileAccess(filePath: string): FileAccessCheckResult {
  // 解析为绝对路径
  const resolved = path.resolve(expandHome(filePath));
  const basename = path.basename(resolved);
  const normalizedCandidates = getPolicyPathCandidates(filePath);

  // 1. 检查敏感路径前缀
  for (const prefix of SENSITIVE_PATH_PREFIXES) {
    if (normalizedCandidates.some(candidate => candidate.startsWith(prefix))) {
      return { allowed: false, reason: `拒绝访问系统敏感文件: ${prefix}` };
    }
  }

  // 2. 检查敏感目录
  const parts = normalizePathSeparators(resolved).split('/');
  for (let i = 0; i < parts.length; i++) {
    if (SENSITIVE_DIR_NAMES.has(parts[i])) {
      return { allowed: false, reason: `拒绝访问敏感目录: ${parts[i]}` };
    }
    // 对多级目录名做拼接检查（如 .config/gcloud）
    if (i > 0) {
      const twoLevel = `${parts[i - 1]}/${parts[i]}`;
      if (SENSITIVE_DIR_NAMES.has(twoLevel)) {
        return { allowed: false, reason: `拒绝访问敏感目录: ${twoLevel}` };
      }
    }
  }

  // 3. 检查敏感文件名
  for (const pattern of SENSITIVE_BASENAME_PATTERNS) {
    if (pattern.test(basename)) {
      return { allowed: false, reason: `拒绝访问敏感文件: ${basename} 可能包含密钥或凭据` };
    }
  }

  return { allowed: true };
}

/**
 * 检查文件路径，若不允许则抛出 Error。
 * 用于在工具 execute 中调用。
 */
export function assertFileAccess(filePath: string): void {
  const result = checkFileAccess(filePath);
  if (!result.allowed) {
    throw new Error(result.reason!);
  }
}

// ── bash 输出敏感信息过滤 ───────────────────────────────────────────

/**
 * 用于检测 bash 命令是否意图泄漏环境变量的模式。
 * 匹配命令开头（支持管道前的部分）。
 */
const ENV_DUMP_COMMANDS = /^\s*(env|printenv|export|set)\b/;
const ENV_ECHO_PATTERN = /\$\{?\w*(KEY|SECRET|TOKEN|PASSWORD|PASS|CREDENTIAL|AUTH|APIKEY|API_KEY)\w*\}?/i;
const ENV_CAT_SENSITIVE = /\bcat\b.*\.(env|pem|key|p12|pfx)\b/i;

/**
 * 检查 bash 命令是否可能泄漏敏感环境变量或文件。
 * 返回 { safe: true } 或 { safe: false, reason: string }。
 */
export function checkBashCommandSafety(command: string): { safe: boolean; reason?: string } {
  const trimmed = command.trim();

  // 拆管道，检查每段
  const segments = trimmed.split(/\s*\|\s*/);
  for (const seg of segments) {
    if (ENV_DUMP_COMMANDS.test(seg)) {
      return { safe: false, reason: '禁止执行环境变量导出命令（env/printenv/export/set），可能泄漏密钥' };
    }
  }

  if (ENV_ECHO_PATTERN.test(trimmed)) {
    return { safe: false, reason: '禁止通过 echo/printf 输出含密钥名的环境变量' };
  }

  if (ENV_CAT_SENSITIVE.test(trimmed)) {
    return { safe: false, reason: '禁止通过 cat 读取敏感文件（.env/.pem/.key）' };
  }

  return { safe: true };
}

// ── bash 命令读写分类（参考 Claude Code BashTool isSearchOrReadBashCommand）──

/** 搜索类命令 */
const BASH_SEARCH_COMMANDS: ReadonlySet<string> = new Set([
  'find', 'grep', 'rg', 'ag', 'ack', 'locate', 'which', 'whereis',
]);

/** 读取/查看类命令 */
const BASH_READ_COMMANDS: ReadonlySet<string> = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'wc', 'stat', 'file', 'strings',
  'jq', 'awk', 'cut', 'sort', 'uniq', 'tr',
]);

/** 目录列出类命令 */
const BASH_LIST_COMMANDS: ReadonlySet<string> = new Set([
  'ls', 'tree', 'du',
]);

/** 语义中性命令 — 纯输出/状态命令，不影响管道是否只读 */
const BASH_NEUTRAL_COMMANDS: ReadonlySet<string> = new Set([
  'echo', 'printf', 'true', 'false', ':',
]);

export interface BashCommandClassification {
  /** 是否为搜索命令 */
  isSearch: boolean;
  /** 是否为读取命令 */
  isRead: boolean;
  /** 是否为列出命令 */
  isList: boolean;
  /** 综合判断：命令是否只读（搜索/读取/列出） */
  isReadOnly: boolean;
}

/**
 * 对 bash 命令进行读/写分类。
 *
 * 对管道命令（如 `cat file | grep pattern`），所有非中性部分
 * 都必须是搜索/读/列出类，整条命令才算只读。
 *
 * 参考 Claude Code BashTool `isSearchOrReadBashCommand`。
 */
export function classifyBashCommand(command: string): BashCommandClassification {
  const trimmed = command.trim();
  // 按管道和操作符拆分
  const parts = trimmed.split(/\s*(?:\|\||&&|\||;)\s*/);

  let hasSearch = false;
  let hasRead = false;
  let hasList = false;
  let hasNonNeutral = false;

  for (const part of parts) {
    const baseCmd = part.trim().split(/\s+/)[0];
    if (!baseCmd) continue;

    // 跳过中性命令
    if (BASH_NEUTRAL_COMMANDS.has(baseCmd)) continue;

    hasNonNeutral = true;
    if (BASH_SEARCH_COMMANDS.has(baseCmd)) hasSearch = true;
    else if (BASH_READ_COMMANDS.has(baseCmd)) hasRead = true;
    else if (BASH_LIST_COMMANDS.has(baseCmd)) hasList = true;
    else {
      // 包含非只读命令 → 整条命令不是只读
      return { isSearch: false, isRead: false, isList: false, isReadOnly: false };
    }
  }

  // 全部中性命令（如 echo "hi"）— 视为只读
  if (!hasNonNeutral) {
    return { isSearch: false, isRead: false, isList: false, isReadOnly: true };
  }

  return {
    isSearch: hasSearch,
    isRead: hasRead,
    isList: hasList,
    isReadOnly: hasSearch || hasRead || hasList,
  };
}

// ── 文件 mtime 比对（参考 Claude Code FileEditTool stale detection）──

/**
 * 文件修改时间快照，用于检测编辑前是否被并发修改。
 */
export async function getFileMtime(filePath: string): Promise<number> {
  const { default: fsPromises } = await import('fs/promises');
  const stat = await fsPromises.stat(filePath);
  return stat.mtimeMs;
}

/**
 * 检查文件在读取后是否被修改。
 * @returns true 表示文件已被修改（stale），应中止编辑
 */
export function isFileStale(savedMtime: number, currentMtime: number): boolean {
  // 允许 1ms 的精度误差
  return Math.abs(currentMtime - savedMtime) > 1;
}

// ── 命令参数转义 ────────────────────────────────────────────────────

/**
 * 安全地转义 shell 参数，防止命令注入。
 * 用单引号包裹，内部单引号用 '\'' 转义。
 */
export function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}
