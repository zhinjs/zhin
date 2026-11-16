/**
 * Format orchestrator tool-call history for end users (IM reply).
 * Avoids dumping raw JSON / internal meta-tool noise.
 */
import {
  compactMediaToolJsonForModel,
  isMediaToolWithBinaryPayload,
  sanitizeToolResult,
} from '@zhin.js/ai';
import type { AgentOutputElement } from '../outbound/agent-output.js';
import type { ReplyFallback } from '../event/turn-event.js';

export interface ToolCallRecord {
  tool: string;
  args?: unknown;
  result: unknown;
  /**
   * Media the framework attached to this call's result (e.g. images a sub-agent produced for
   * `ask`, #1250); merged into the reply like media the tool returned itself.
   */
  media?: readonly AgentOutputElement[];
  /** How the call settled; absent on records that predate #1250 (treated as unknown). */
  status?: 'completed' | 'denied' | 'failed';
  /** The tool is not declared read-only, so a denial or failure means a write/change did not happen. */
  sideEffect?: boolean;
  /** #1250 batch 26: the tool ran and reported a failure in its result; part of it may have taken effect. */
  reported?: boolean;
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

/** Where the reply is being produced, so a fallback can name the right next step (#1250 b33). */
export interface ReplyFallbackContext {
  /** The turn offered the model at least one tool. Absent: unknown (treated as available). */
  readonly toolsAvailable?: boolean;
  /** A scheduled job's run: named in the text with `zhin trace`; `/reset` is never suggested. */
  readonly schedule?: Readonly<{ jobId: string; label?: string; turnId?: string }>;
}

/** Inline-code a tool name so Markdown cannot eat `__` or `*` in it (#1250 b33). */
export function inlineToolName(name: string): string {
  const fence = name.includes('`') ? '``' : '`';
  return `${fence}${name}${fence}`;
}

/**
 * #1250 b33: the fallback text for a turn whose model wrote no visible reply, stating the actual cause.
 * Interactive turns get a next step; a scheduled job gets its name / id and `zhin trace <turnId>` instead
 * of `/reset` (the job's own session is not the chat the owner would reset).
 */
export function formatReplyFallback(fallback: ReplyFallback, context: ReplyFallbackContext = {}): string {
  const tools = fallback.tools?.length ? fallback.tools.map(inlineToolName).join('、') : '';
  const cause = fallback.cause === 'no_tools'
    ? '本轮没有可用的工具，模型也没有给出回复'
    : fallback.cause === 'tool_denied'
      ? `需要的工具${tools ? ` ${tools} ` : ''}被拒绝，没有运行`
      : '模型未返回可见内容（可能为推理型模型空回复或上下文过长）';
  const schedule = context.schedule;
  if (schedule) {
    const name = schedule.label ? `「${schedule.label}」（${schedule.jobId}）` : schedule.jobId;
    const next = fallback.cause === 'no_tools'
      ? '请检查任务的执行计划和可用工具，或先用 schedule_preview 预演'
      : fallback.cause === 'tool_denied'
        ? '无人值守时需要审批的工具会被拒绝，请检查审批设置或任务的工具'
        : '可以换用其他模型后手动运行一次';
    const trace = schedule.turnId ? `排查：zhin trace ${schedule.turnId}` : '排查：zhin trace';
    return `定时任务 ${name} 没有完成：${cause}。${next}。${trace}`;
  }
  if (fallback.cause === 'no_tools') return `${cause}，所以没能完成这个请求。可以换一种说法再试。`;
  if (fallback.cause === 'tool_denied') return `${cause}，所以没能完成这个请求。需要有权限的人批准后再试。`;
  return `${cause}。可发送 /reset 后重试，或换用非推理模型。`;
}

/**
 * User-facing text built from the tool-call history when the model wrote no reply, and whether that text
 * is a fallback (no usable tool output) rather than the tools' own results.
 */
export function describeToolCallsForUser(
  toolCalls: readonly ToolCallRecord[],
  context: ReplyFallbackContext = {},
): { text: string; fallback?: ReplyFallback } {
  const otherParts: string[] = [];
  const denied: string[] = [];
  let exploredOnly = false;

  for (const tc of toolCalls) {
    if (INTERNAL_META_TOOLS.has(tc.tool)) continue;
    if (tc.status === 'denied') {
      // A denial is not a tool result; its model-facing text must not reach the user (#1250 b33).
      if (!denied.includes(tc.tool)) denied.push(tc.tool);
      continue;
    }
    if (EXPLORATION_TOOLS.has(tc.tool)) {
      exploredOnly = true;
      continue;
    }
    const block = formatGenericToolResult(tc.tool, tc.result);
    if (block) otherParts.push(block);
  }

  if (otherParts.length > 0) {
    return { text: truncate(otherParts.join('\n\n'), MAX_SUMMARY_CHARS) };
  }
  if (denied.length > 0) {
    const fallback: ReplyFallback = { cause: 'tool_denied', tools: denied };
    return { text: formatReplyFallback(fallback, context), fallback };
  }
  if (toolCalls.length === 0) {
    const fallback: ReplyFallback = { cause: context.toolsAvailable === false ? 'no_tools' : 'empty_reply' };
    return { text: formatReplyFallback(fallback, context), fallback };
  }
  if (exploredOnly && !context.schedule) {
    return { text: EXPLORATION_ONLY_REPLY, fallback: { cause: 'empty_reply' } };
  }
  const fallback: ReplyFallback = { cause: 'empty_reply' };
  return {
    text: context.schedule ? formatReplyFallback(fallback, context)
      : '未能从工具结果中提取有效信息，请换一种说法或缩小问题范围后重试。',
    fallback,
  };
}

/**
 * Build a single user-facing message from tool call history.
 */
export function formatToolCallsForUser(toolCalls: ToolCallRecord[], context?: ReplyFallbackContext): string {
  return describeToolCallsForUser(toolCalls, context).text;
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
