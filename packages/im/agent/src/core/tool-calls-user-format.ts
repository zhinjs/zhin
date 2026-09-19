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
    return compact.length > 2000 ? `${compact.slice(0, 2000)}…` : compact;
  }
  const cleaned = sanitizeToolResult(raw, { maxChars: 2000 });
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

  for (const tc of toolCalls) {
    if (INTERNAL_META_TOOLS.has(tc.tool)) continue;
    const block = formatGenericToolResult(tc.tool, tc.result);
    if (block) otherParts.push(block);
  }

  if (otherParts.length > 0) {
    return otherParts.join('\n\n');
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
