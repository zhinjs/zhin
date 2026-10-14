/**
 * Format orchestrator tool-call history for end users (IM reply).
 * Avoids dumping raw JSON / internal meta-tool noise.
 */
import {
  compactMediaToolJsonForModel,
  isMediaToolWithBinaryPayload,
  sanitizeToolResult,
} from '@zhin.js/ai';

export interface ToolCallRecord {
  tool: string;
  args?: unknown;
  result: unknown;
}

const INTERNAL_META_TOOLS = new Set(['load_skill', 'discover', 'load_tool']);

/**
 * Read-only exploration tools whose bodies (file contents, grep hits, page
 * text) are context for the model, not answers for the user.
 */
export const EXPLORATION_TOOLS: ReadonlySet<string> = new Set(['read_file', 'grep', 'glob', 'list_dir', 'web_fetch']);

/** Per-tool and total caps for the user-facing summary. */
const MAX_TOOL_BLOCK_CHARS = 2000;
const MAX_SUMMARY_CHARS = 3000;

const EXPLORATION_ONLY_REPLY =
  '这一轮只做了资料查阅，还没有整理出结论。回复「继续」我会接着处理，或者把需求说得更具体一些再试。';

function asString(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function formatGenericToolResult(tool: string, result: unknown): string {
  const raw = asString(result);
  if (isMediaToolWithBinaryPayload(tool) && raw.trim().startsWith('{')) {
    const compact = compactMediaToolJsonForModel(tool, raw);
    return truncate(compact, MAX_TOOL_BLOCK_CHARS);
  }
  const cleaned = sanitizeToolResult(raw, { maxChars: MAX_TOOL_BLOCK_CHARS });
  if (!cleaned) return '';
  return cleaned;
}

/**
 * Build a single user-facing message from tool call history.
 */
export function formatToolCallsForUser(toolCalls: ToolCallRecord[]): string {
  if (toolCalls.length === 0) {
    return '模型未返回可见内容（可能为推理型模型空回复或上下文过长）。可发送 /reset 后重试，或换用非推理模型。';
  }

  const otherParts: string[] = [];
  let exploredOnly = false;

  for (const tc of toolCalls) {
    if (INTERNAL_META_TOOLS.has(tc.tool)) continue;
    if (EXPLORATION_TOOLS.has(tc.tool)) {
      exploredOnly = true;
      continue;
    }
    const block = formatGenericToolResult(tc.tool, tc.result);
    if (block) otherParts.push(block);
  }

  if (otherParts.length > 0) {
    return truncate(otherParts.join('\n\n'), MAX_SUMMARY_CHARS);
  }

  if (exploredOnly) {
    return EXPLORATION_ONLY_REPLY;
  }

  return '未能从工具结果中提取有效信息，请换一种说法或缩小问题范围后重试。';
}

/** Agent 内置兜底正文（如 max-iter / error recover）是否应改用 formatToolCallsForUser */
export function looksLikeInternalToolDump(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^Done\.\s+Information retrieved:/i.test(t)) return true;
  if (t.toLowerCase().startsWith('something went wrong:') && t.includes('【') && t.includes('】')) return true;
  if (countBracketBlocks(t) >= 2) return true;
  return false;
}

function countBracketBlocks(text: string): number {
  let count = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('【', cursor);
    if (start < 0) break;
    const end = text.indexOf('】', start + 1);
    if (end < 0) break;
    count++;
    cursor = end + 1;
  }
  return count;
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
