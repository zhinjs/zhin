/**
 * 文件访问安全策略
 *
 * 防止 AI Agent 读写敏感文件（如 .env、密钥、证书等），
 * 并将 bash/grep/glob 等工具的命令注入风险降到最低。
 *
 * 三层防御:
 *  1. 敏感文件名/路径模式 — 阻止 .env、私钥、证书等
 *  2. 敏感目录 — 阻止 .ssh, .gnupg 等
 *  3. bash 环境变量泄漏 — 过滤 env/printenv/export 输出中的敏感值
 */

import * as path from 'path';
import * as os from 'os';

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

/**
 * 检查文件路径是否允许被 AI Agent 访问。
 * 该函数只做「阻止明确敏感文件」的检查，不做正向白名单。
 */
export function checkFileAccess(filePath: string): FileAccessCheckResult {
  // 解析为绝对路径
  const resolved = path.resolve(filePath.replace(/^~/, os.homedir()));
  const basename = path.basename(resolved);
  const normalized = resolved.replace(/\\/g, '/');

  // 1. 检查敏感路径前缀
  for (const prefix of SENSITIVE_PATH_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return { allowed: false, reason: `拒绝访问系统敏感文件: ${prefix}` };
    }
  }

  // 2. 检查敏感目录
  const parts = normalized.split('/');
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

// ── 命令参数转义 ────────────────────────────────────────────────────

/**
 * 安全地转义 shell 参数，防止命令注入。
 * 用单引号包裹，内部单引号用 '\'' 转义。
 */
export function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}
