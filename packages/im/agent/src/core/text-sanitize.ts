import { relativizeCwdPaths, stripHallucinatedToolCalls } from '@zhin.js/ai';
import { looksLikeInternalToolDump } from './tool-calls-user-format.js';

export { stripHallucinatedToolCalls };

/** Strip `<think>...</think>` blocks that some reasoning models embed in content. */
export function stripThinkBlocks(text: string): string {
  let out = '';
  let cursor = 0;
  const lower = text.toLowerCase();
  while (cursor < text.length) {
    const start = lower.indexOf('<think>', cursor);
    if (start < 0) break;
    const end = lower.indexOf('</think>', start + '<think>'.length);
    if (end < 0) break;
    out += text.slice(cursor, start);
    cursor = end + '</think>'.length;
    while (cursor < text.length && /\s/.test(text[cursor]!)) cursor++;
  }
  return (out + text.slice(cursor)).trim();
}

const RAW_TOOL_MARKUP_RE =
  /DSML|tool_calls>|<\|?tool_calls\|?>|<tool_call\b|<tool_result\b|<function=|<<<tool_call>>>|<\|plugin\|>/i;

/**
 * True when text still looks like model-emitted tool XML/DSML (not user-facing prose).
 */
export function looksLikeRawToolMarkup(text: string): boolean {
  return RAW_TOOL_MARKUP_RE.test(text);
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
