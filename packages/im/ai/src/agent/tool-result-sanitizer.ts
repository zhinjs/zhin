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

export const TOOL_RESULT_OMITTED_PLAIN =
  'Tool returned non-plain control payload; omitted.';

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

/** 去掉模型误输出的 tool_call / DSML 等标记（保留其余正文） */
export function stripHallucinatedToolCalls(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/<tool_call\b[\s\S]*?(?:\/>|<\/tool_call>)/gi, '');
  cleaned = cleaned.replace(/<tool_result\b[\s\S]*?(?:\/>|<\/tool_result>)/gi, '');
  cleaned = cleaned.replace(/<function=[^>]*>[\s\S]*?<\/function>/gi, '');
  cleaned = cleaned.replace(/\{tool_(?:result|call)\}/gi, '');
  cleaned = cleaned.replace(/<\|plugin\|>[\s\S]*?<\|\/plugin\|>/gi, '');
  cleaned = cleaned.replace(/<<<tool_call>>>[\s\S]*?<<<end>>>/gi, '');
  cleaned = cleaned.replace(/<\|tool_calls\|>[\s\S]*?<\|\/tool_calls\|>/gi, '');
  cleaned = cleaned.replace(/<\|?tool_calls\|?>[\s\S]*?<\|?\/tool_calls\|?>/gi, '');

  cleaned = stripDsmlMarkup(cleaned);

  return cleaned.trim();
}

/** 线性移除含 DSML 的伪标签（避免嵌套回溯正则） */
function stripDsmlMarkup(text: string): string {
  let work = text;
  let changed = true;
  while (changed) {
    changed = false;
    let i = 0;
    let out = '';
    while (i < work.length) {
      const lt = work.indexOf('<', i);
      if (lt === -1) {
        out += work.slice(i);
        break;
      }
      out += work.slice(i, lt);
      const gt = work.indexOf('>', lt + 1);
      if (gt === -1) {
        out += work.slice(lt);
        break;
      }
      const tag = work.slice(lt, gt + 1);
      if (/DSML/i.test(tag)) {
        const closeLt = work.indexOf('</', gt + 1);
        if (closeLt !== -1) {
          const closeGt = work.indexOf('>', closeLt + 2);
          i = closeGt === -1 ? work.length : closeGt + 1;
          changed = true;
          continue;
        }
        i = gt + 1;
        changed = true;
        continue;
      }
      out += tag;
      i = gt + 1;
    }
    work = out;
  }
  return work;
}

export function isOmittedToolSummary(text: string): boolean {
  const t = text.trim();
  return !t || t === TOOL_RESULT_OMITTED_PLAIN;
}

/** 出站需保留完整 base64 JSON，但喂给模型的结果须去掉大二进制字段 */
export const MEDIA_TOOL_NAMES_WITH_BINARY_JSON = new Set([
  'generate_image',
  'voice_tts',
]);

export function isMediaToolWithBinaryPayload(toolName: string): boolean {
  return MEDIA_TOOL_NAMES_WITH_BINARY_JSON.has(toolName);
}

/**
 * 将 generate_image / voice_tts 等工具返回的巨型 base64 JSON 压缩为模型可读摘要，
 * 避免 sanitizeToolResult 截断破坏 JSON，同时不把二进制塞进上下文。
 */
export function compactMediaToolJsonForModel(toolName: string, raw: string): string {
  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw;
    obj = parsed as Record<string, unknown>;
  } catch {
    return raw;
  }

  if (toolName === 'generate_image' && typeof obj.image === 'string') {
    const len = obj.image.length;
    return JSON.stringify({
      ...obj,
      image: `[omitted ${len} base64 chars; image will be sent to the user as attachment]`,
      sent_to_user: true,
    });
  }

  if (toolName === 'voice_tts' && typeof obj.audio === 'string') {
    const len = obj.audio.length;
    return JSON.stringify({
      ...obj,
      audio: `[omitted ${len} base64 chars; audio will be sent to the user]`,
      sent_to_user: true,
    });
  }

  return raw;
}

/** 解析媒体工具原始 JSON，供 IM 出站合并（勿经 sanitize） */
export function parseMediaToolResultForOutbound(
  toolName: string,
  raw: string,
): Record<string, unknown> | string {
  if (!isMediaToolWithBinaryPayload(toolName)) return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return raw;
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
  let raw = stripHallucinatedToolCalls((text || '').trim());
  if (!raw) return '';
  if (/<tool_call|<function=/i.test(raw)) {
    return TOOL_RESULT_OMITTED_PLAIN;
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

