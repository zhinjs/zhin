/**
 * 用户可见路径缩短：项目根内 ./…，HOME 内 ~/…，其余保留绝对路径。
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DisplayPathOptions {
  /** 默认 `process.env.ZHIN_PROJECT_ROOT` 或 `process.cwd()` */
  projectRoot?: string;
  /** 默认 `os.homedir()` */
  homeDir?: string;
  /** 为 true 时优先 `~/…`（启动摘要「路径」等场景） */
  preferHome?: boolean;
}

const FILE_URL_RE = /file:\/\/[^\s"'`,)\]}?#]+/g;
const UNIX_ABS_IN_TEXT_RE = /(^|[\s('"[{,])(\/(?:[\w.@$+-]|%[0-9A-Fa-f]{2})+(?:\/(?:[\w.@$+-]|%[0-9A-Fa-f]{2})+)*)/g;
const WIN_ABS_IN_TEXT_RE = new RegExp(
  '(^|[\\s(\'"\\[{,])([A-Za-z]:[\\\\/][^\\s"\'`,)\\]}]+)',
  'g',
);

function resolveProjectRoot(options?: DisplayPathOptions): string {
  const env = process.env.ZHIN_PROJECT_ROOT?.trim();
  return path.resolve(options?.projectRoot ?? env ?? process.cwd());
}

function resolveHomeDir(options?: DisplayPathOptions): string {
  return path.resolve(options?.homeDir ?? os.homedir());
}

function toDisplaySlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

function stripFileUrlQuery(fileUrl: string): string {
  const q = fileUrl.indexOf('?');
  return q >= 0 ? fileUrl.slice(0, q) : fileUrl;
}

function relativizeToRoot(resolved: string, root: string): string | null {
  if (resolved === root) return '.';
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(prefix)) return null;
  const rel = toDisplaySlashes(path.relative(root, resolved));
  return rel === '' ? '.' : `./${rel}`;
}

function relativizeToHome(resolved: string, home: string): string | null {
  if (resolved === home) return '~';
  const prefix = home.endsWith(path.sep) ? home : home + path.sep;
  if (!resolved.startsWith(prefix)) return null;
  const rel = toDisplaySlashes(path.relative(home, resolved));
  return rel === '' ? '~' : `~/${rel}`;
}

/** 字段名是否暗示路径值 */
export function isPathLikeField(key: string): boolean {
  return /path|file|dir|root|config/i.test(key);
}

/** 值是否像文件系统绝对路径（不含 http(s)） */
export function looksLikeAbsolutePath(value: string): boolean {
  const v = value.trim();
  if (!v || /^https?:\/\//i.test(v)) return false;
  if (v.startsWith('file://')) return true;
  if (path.isAbsolute(v)) return true;
  if (v.startsWith('/')) return true;
  if (/^[A-Za-z]:[\\/]/.test(v)) return true;
  return false;
}

/**
 * 将单条路径缩短为 `./…`、`~/…` 或保留绝对路径。
 */
export function formatDisplayPath(input: string, options?: DisplayPathOptions): string {
  if (!input) return input;
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return input;

  const isFileUrl = trimmed.startsWith('file://');
  let raw = trimmed;
  if (isFileUrl) {
    try {
      raw = fileURLToPath(stripFileUrlQuery(trimmed));
    } catch {
      return input;
    }
  }

  let resolved: string;
  try {
    resolved = path.resolve(raw);
  } catch {
    return input;
  }

  const projectRoot = resolveProjectRoot(options);
  const homeDir = resolveHomeDir(options);

  const order = options?.preferHome
    ? (['home', 'project'] as const)
    : (['project', 'home'] as const);

  for (const kind of order) {
    const shortened = kind === 'home'
      ? relativizeToHome(resolved, homeDir)
      : relativizeToRoot(resolved, projectRoot);
    if (shortened != null) {
      return isFileUrl ? `file://${shortened}` : shortened;
    }
  }

  if (isFileUrl) {
    return `file://${toDisplaySlashes(resolved)}`;
  }
  return input;
}

function applyRootShortening(text: string, root: string, style: 'dot' | 'tilde'): string {
  if (!root || root === '/') return text;
  const forward = toDisplaySlashes(root);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  const forwardPrefix = `${forward}/`;
  const marker = style === 'dot' ? './' : '~/';

  let out = text;
  for (const p of [prefix, forwardPrefix].sort((a, b) => b.length - a.length)) {
    if (p.length <= 1) continue;
    out = out.split(p).join(marker);
  }

  const exactRep = style === 'dot' ? '.' : '~';
  for (const exact of [root, forward]) {
    if (exact.length <= 1) continue;
    const esc = exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`${esc}(?=["'\\s)\\]},.:;!?]|$)`, 'g'), exactRep);
  }
  return out;
}

/**
 * 在自由文本中缩短绝对路径与 file:// URL（供 AI 工具结果等使用）。
 */
export function shortenPathsInText(text: string, options?: DisplayPathOptions): string {
  if (!text) return text;

  let out = text.replace(FILE_URL_RE, (m) => formatDisplayPath(m, options));

  const projectRoot = resolveProjectRoot(options);
  const homeDir = resolveHomeDir(options);
  out = applyRootShortening(out, projectRoot, 'dot');
  out = applyRootShortening(out, homeDir, 'tilde');

  out = out.replace(UNIX_ABS_IN_TEXT_RE, (match, lead, absPath) => {
    const shortened = formatDisplayPath(absPath, options);
    return shortened === absPath ? match : `${lead}${shortened}`;
  });

  out = out.replace(WIN_ABS_IN_TEXT_RE, (match, lead, absPath) => {
    const shortened = formatDisplayPath(absPath, options);
    return shortened === absPath ? match : `${lead}${shortened}`;
  });

  return out;
}
