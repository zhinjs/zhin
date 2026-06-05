/**
 * Format orchestrator tool-call history for end users (IM reply).
 * Avoids dumping raw JSON / internal meta-tool noise.
 */
import {
  compactMediaToolJsonForModel,
  isMediaToolWithBinaryPayload,
  isOmittedToolSummary,
  sanitizeToolResult,
} from '@zhin.js/ai';

export interface ToolCallRecord {
  tool: string;
  args?: unknown;
  result: unknown;
}

const INTERNAL_META_TOOLS = new Set(['activate_skill', 'install_skill', 'tool_search']);

function asString(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function parseRunDeferredPayload(raw: string): {
  status?: string;
  summary?: string;
  error?: string;
} | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    return {
      status: typeof obj.status === 'string' ? obj.status : undefined,
      summary: typeof obj.summary === 'string' ? obj.summary : undefined,
      error: typeof obj.error === 'string' ? obj.error : undefined,
    };
  } catch {
    return null;
  }
}

function formatRunDeferredTaskResult(result: unknown): string | undefined {
  const raw = asString(result);
  const parsed = parseRunDeferredPayload(raw);
  if (parsed) {
    if (parsed.status === 'error') {
      return parsed.error || '子任务执行失败。';
    }
    const summary = parsed.summary?.trim();
    if (summary && !isOmittedToolSummary(summary)) {
      const cleaned = sanitizeToolResult(summary, { maxChars: 4000 });
      if (!isOmittedToolSummary(cleaned)) {
        const prefix =
          parsed.status === 'partial'
            ? '子任务未完全结束（已达最大轮次），以下为已收集结果：\n\n'
            : '';
        return `${prefix}${cleaned}`;
      }
    }
    if (parsed.status === 'partial') {
      return '子任务未完全结束（已达最大轮次），且没有可展示的摘要。请把目标拆小后重试。';
    }
    return '子任务已完成，但没有可展示的文本摘要。';
  }
  const cleaned = sanitizeToolResult(raw, { maxChars: 4000 });
  return cleaned || undefined;
}

function formatGenericToolResult(tool: string, result: unknown): string {
  const raw = asString(result);
  if (isMediaToolWithBinaryPayload(tool) && raw.trim().startsWith('{')) {
    const compact = compactMediaToolJsonForModel(tool, raw);
    return compact.length > 2000 ? `${compact.slice(0, 2000)}…` : compact;
  }
  const cleaned = sanitizeToolResult(raw, { maxChars: 2000 });
  if (!cleaned) return '';
  if (INTERNAL_META_TOOLS.has(tool)) return cleaned;
  return cleaned;
}

/**
 * Build a single user-facing message from tool call history.
 */
export function formatToolCallsForUser(toolCalls: ToolCallRecord[]): string {
  if (toolCalls.length === 0) {
    return '任务已结束，但没有可展示的结果。';
  }

  const deferredSummaries: string[] = [];
  const otherParts: string[] = [];
  let toolSearchNote: string | undefined;

  for (const tc of toolCalls) {
    if (tc.tool === 'run_deferred_task') {
      const block = formatRunDeferredTaskResult(tc.result);
      if (block) deferredSummaries.push(block);
      continue;
    }
    if (tc.tool === 'tool_search') {
      toolSearchNote = formatGenericToolResult(tc.tool, tc.result);
      continue;
    }
    if (INTERNAL_META_TOOLS.has(tc.tool)) continue;
    const block = formatGenericToolResult(tc.tool, tc.result);
    if (block) otherParts.push(block);
  }

  if (deferredSummaries.length > 0) {
    const last = deferredSummaries[deferredSummaries.length - 1]!;
    if (deferredSummaries.length > 1) {
      return [
        `（共执行 ${deferredSummaries.length} 次子任务，以下为最后一次结果）`,
        '',
        last,
      ].join('\n');
    }
    return last;
  }

  if (otherParts.length > 0) {
    return otherParts.join('\n\n');
  }

  if (toolSearchNote) {
    return toolSearchNote;
  }

  return '未能从工具结果中提取有效信息，请换一种说法或缩小问题范围后重试。';
}

/** Agent 内置兜底正文（如 max-iter / error recover）是否应改用 formatToolCallsForUser */
export function looksLikeInternalToolDump(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^Done\.\s+Information retrieved:/i.test(t)) return true;
  if (/^Something went wrong:/i.test(t) && /【\w+】/.test(t)) return true;
  const blocks = t.match(/【[^】]+】/g);
  if ((blocks?.length ?? 0) >= 2) return true;
  if (/【run_deferred_task】[\s\S]*"status"\s*:/i.test(t)) return true;
  return false;
}
