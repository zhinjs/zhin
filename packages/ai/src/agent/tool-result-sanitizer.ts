import path from 'node:path';

/**
 * Unified sanitizer for tool outputs before feeding back to model/user.
 *
 * Goal: aggressively remove obvious HTML/anti-bot noise while keeping
 * meaningful textual findings; normalize absolute project paths to `./…`.
 */
export interface ToolResultSanitizerOptions {
  maxChars?: number;
  /** 项目根目录，默认 `process.cwd()` */
  cwd?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 将文本中的 `cwd` 绝对路径批量替换为以 `.` 开头的相对路径（便于 IM 展示）。
 */
export function relativizeCwdPaths(text: string, cwd: string = process.cwd()): string {
  if (!text) return text;
  const root = path.resolve(cwd);
  if (!root || root === '/') return text;

  const forward = root.replace(/\\/g, '/');
  const prefixes: Array<[string, string]> = [
    [root + path.sep, `.${path.sep}`],
    [`${forward}/`, './'],
  ];
  let out = text;
  for (const [from, to] of prefixes.sort((a, b) => b[0].length - a[0].length)) {
    if (from.length <= 1) continue;
    out = out.split(from).join(to);
  }

  for (const exact of [root, forward]) {
    if (exact.length <= 1) continue;
    const esc = escapeRegExp(exact);
    out = out.replace(
      new RegExp(`${esc}(?=["'\\s)\\]},.:;!?]|$)`, 'g'),
      '.',
    );
  }
  return out;
}

const DEFAULT_MAX_CHARS = 12_000;
const HTML_SIGNAL_RE = /<!doctype html|<html\b|<head\b|<body\b|<script\b|<meta\b|<\/\w+>/i;
const ANTI_BOT_SIGNAL_RE = /verifycode|captcha|antibot|enablejs|window\.location\.assign/i;
const BASE64ISH_RE = /^[A-Za-z0-9+/=]{200,}$/;
const MINIFIED_JS_LINE_RE =
  /\(function\s*\(|google\.(?:c|timers)|SPDX-License-Identifier|var\s+\w+=this\|\|self|window\.prs|prototype\.toString=function/;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated]`;
}

function compactLine(line: string): string {
  const compact = line.trim().replace(/\s+/g, ' ');
  return compact.length > 280 ? `${compact.slice(0, 280)} …` : compact;
}

function finalizeSanitizedText(text: string, maxChars: number, cwd?: string): string {
  return truncate(relativizeCwdPaths(text, cwd), maxChars);
}

export function sanitizeToolResult(
  text: string,
  options: ToolResultSanitizerOptions = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const cwd = options.cwd;
  const raw = (text || '').trim();
  if (!raw) return '';
  if (/<tool_call|<function=/i.test(raw)) {
    return 'Tool returned non-plain control payload; omitted.';
  }

  const noisy =
    HTML_SIGNAL_RE.test(raw)
    || ANTI_BOT_SIGNAL_RE.test(raw)
    || MINIFIED_JS_LINE_RE.test(raw)
    || (raw.length > 1000 && /[<>]/.test(raw))
    || (raw.length > 800 && MINIFIED_JS_LINE_RE.test(raw));

  if (!noisy) return finalizeSanitizedText(raw, maxChars, cwd);

  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  let omitted = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const hasMarkup = /[<>]/.test(trimmed);
    if (
      HTML_SIGNAL_RE.test(trimmed)
      || ANTI_BOT_SIGNAL_RE.test(trimmed)
      || BASE64ISH_RE.test(trimmed)
      || MINIFIED_JS_LINE_RE.test(trimmed)
      || (hasMarkup && trimmed.length > 180)
      || (trimmed.length > 200 && (trimmed.match(/function/g)?.length ?? 0) >= 3)
    ) {
      omitted = true;
      continue;
    }
    kept.push(compactLine(trimmed));
    if (kept.length >= 36) break;
  }

  let summary = kept.join('\n').trim();
  if (!summary) {
    summary = '工具返回内容多为页面脚本或反爬数据，已省略原始输出。';
  } else if (omitted) {
    summary += '\n（已省略无关的页面/脚本噪声）';
  }
  return finalizeSanitizedText(summary, maxChars, cwd);
}

