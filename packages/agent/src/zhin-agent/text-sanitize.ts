import { relativizeCwdPaths } from '@zhin.js/ai';
import { looksLikeInternalToolDump } from './tool-calls-user-format.js';

/** Strip `<think>...</think>` blocks that some reasoning models embed in content. */
export function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
}

const RAW_TOOL_MARKUP_RE =
  /DSML|tool_calls>|<\|?tool_calls\|?>|<tool_call\b|<tool_result\b|<function=|<<<tool_call>>>|<\|plugin\|>/i;

/**
 * True when text still looks like model-emitted tool XML/DSML (not user-facing prose).
 */
export function looksLikeRawToolMarkup(text: string): boolean {
  return RAW_TOOL_MARKUP_RE.test(text);
}

/**
 * Strip hallucinated tool-call markup that some models emit as plain text.
 * Covers XML-style, plugin fences, and DeepSeek DSML (`<｜｜DSML｜｜invoke>` …).
 */
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

  // DeepSeek DSML: nested `<…DSML…>…</…DSML…>` (fullwidth `｜` or ASCII `|`)
  let prev: string;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(/<[^>]*DSML[^>]*>[\s\S]*?<\/[^>]*DSML[^>]*>/gi, '');
  } while (cleaned !== prev);
  cleaned = cleaned.replace(/<[^>]*DSML[^>]*tool_calls[^>]*>[\s\S]*$/gi, '');
  cleaned = cleaned.replace(/<[^>]*DSML[^>]*>/gi, '');

  return cleaned.trim();
}

export interface SanitizeAssistantReplyOptions {
  /** Fallback when stripped content is empty or still markup (e.g. tool-run summary). */
  toolSummary?: string;
  emptyMessage?: string;
  /** 项目根目录，默认 `process.cwd()` */
  cwd?: string;
}

function outboundText(text: string, cwd?: string): string {
  return relativizeCwdPaths(text, cwd);
}

const DEFAULT_EMPTY_REPLY =
  '抱歉，模型返回了无效的工具调用格式，未能生成可读回复。请重试或换一种说法。';

/**
 * Single outbound gate: strip think/tool markup, reject raw DSML/XML, then fallback.
 */
export function sanitizeAssistantReply(
  raw: string,
  options: SanitizeAssistantReplyOptions = {},
): string {
  const cwd = options.cwd;
  const stripped = stripHallucinatedToolCalls(stripThinkBlocks(raw));
  const summary = options.toolSummary?.trim() ?? '';

  if (looksLikeInternalToolDump(stripped) && summary && !looksLikeRawToolMarkup(summary)) {
    return outboundText(summary, cwd);
  }

  if (stripped && !looksLikeRawToolMarkup(stripped) && !looksLikeInternalToolDump(stripped)) {
    return outboundText(stripped, cwd);
  }

  if (summary && !looksLikeRawToolMarkup(summary)) {
    return outboundText(summary, cwd);
  }

  return outboundText(options.emptyMessage ?? DEFAULT_EMPTY_REPLY, cwd);
}
