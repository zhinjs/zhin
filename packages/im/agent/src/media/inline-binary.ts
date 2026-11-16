/**
 * #1250 第 29 批：工具结果进入模型之前的内嵌二进制兜底（base64 data URL、超长 base64 串）。
 *
 * - 一般工具：base64 载荷 ≥ {@link INLINE_BINARY_MIN_CHARS} 字符的 data URL 与裸串替换为一行「已省略」说明；
 * - 读文件 / 探索 / shell 类工具（结果可能被原样写回文件）：只截断 ≥ {@link FILE_TOOL_TRUNCATE_CHARS} 的
 *   极长串，并标明「已截断」；更短的 data URL（CSS / SVG 内嵌图标）原样保留，避免 read_file → write_file
 *   把占位写进文件；
 * - 占位文本有固定形态（{@link containsInlineBinaryPlaceholder}），write_file / edit_file 拒绝写入含占位的内容。
 *
 * 一次线性扫描（每个字符只看一次，data URL 前缀只回看有限长度），构造输入也不会退化为平方复杂度。
 */
import type { AgentMessage, AssistantMessage, Context, LlmCompletionPort, UserMessage } from '@zhin.js/ai';
import type { Segment } from '@zhin.js/im-contract';
import type { AgentOutputElement } from '../outbound/agent-output.js';
import { EXPLORATION_TOOLS } from '../core/tool-calls-user-format.js';

/** Base64 payloads shorter than this are left alone for ordinary tools (icons, ids, test fixtures). */
export const INLINE_BINARY_MIN_CHARS = 2048;
/** File / exploration tools: only runs this long are cut (64 KiB), and the cut is labelled. */
export const FILE_TOOL_TRUNCATE_CHARS = 64 * 1024;

/** Tools whose output may be written back to a file verbatim: never replace content there below the truncation limit. */
const FILE_CONTENT_TOOLS: ReadonlySet<string> = new Set([...EXPLORATION_TOOLS, 'bash', 'shell', 'exec']);

/** Longest `data:<mime>[;k=v]*;base64,` prefix looked back for (bounded, so the scan stays linear). */
const MAX_DATA_PREFIX = 160;
const DATA_PREFIX_AT_END = /data:([\w.+-]+\/[\w.+-]+)?(?:;[\w.+-]+=[\w.+-]+)*;base64,$/iu;

/** Matches every placeholder this module writes (and nothing a real file is likely to contain). */
const PLACEHOLDER = /\[已(?:省略|截断)[^[\]\n]{0,80}数据（\d+ 字符）/u;

export interface OmitInlineBinaryOptions {
  /** Tool the text came from; file / exploration / shell tools get the truncate-only rule. */
  readonly toolName?: string;
}

function isBase64Char(code: number): boolean {
  return (code >= 65 && code <= 90) // A-Z
    || (code >= 97 && code <= 122) // a-z
    || (code >= 48 && code <= 57) // 0-9
    || code === 43 || code === 47 // + /
    || code === 45 || code === 95; // - _ (URL-safe)
}

export function isFileContentTool(toolName: string | undefined): boolean {
  return toolName !== undefined && FILE_CONTENT_TOOLS.has(toolName);
}

/**
 * Replace inline binary in model-facing text (see the module comment for the rules). Only the
 * text the model sees changes; outbound media never passes through here.
 */
export function omitInlineBinaryForModel(text: string, options: OmitInlineBinaryOptions = {}): string {
  const fileTool = isFileContentTool(options.toolName);
  const threshold = fileTool ? FILE_TOOL_TRUNCATE_CHARS : INLINE_BINARY_MIN_CHARS;
  if (text.length < threshold) return text;
  let out = '';
  let copied = 0;
  let i = 0;
  const length = text.length;
  while (i < length) {
    if (!isBase64Char(text.charCodeAt(i))) { i += 1; continue; }
    const start = i;
    while (i < length && isBase64Char(text.charCodeAt(i))) i += 1;
    let end = i;
    // Up to two `=` padding characters belong to the run.
    while (end < length && end - i < 2 && text.charCodeAt(end) === 61) end += 1;
    const runLength = end - start;
    if (runLength < threshold) { i = end; continue; }
    const before = text.slice(Math.max(copied, start - MAX_DATA_PREFIX), start);
    const prefix = DATA_PREFIX_AT_END.exec(before);
    const replaceFrom = prefix ? start - prefix[0].length : start;
    const mime = prefix?.[1];
    const label = prefix ? `内嵌${mime ? ` ${mime}` : ''} ` : 'base64 ';
    const replacement = fileTool
      ? `[已截断 ${label}数据（${runLength} 字符），未提供给模型；原文仍完整保留，不要把这段写回文件]`
      : `[已省略 ${label}数据（${runLength} 字符），未提供给模型]`;
    out += text.slice(copied, replaceFrom) + replacement;
    copied = end;
    i = end;
  }
  return copied === 0 ? text : out + text.slice(copied);
}

/** True when `text` holds a placeholder written by {@link omitInlineBinaryForModel}. */
export function containsInlineBinaryPlaceholder(text: string): boolean {
  return text.includes('[已') && PLACEHOLDER.test(text);
}

/** Error text for a write that would put a placeholder into a file. */
export const INLINE_BINARY_PLACEHOLDER_WRITE_ERROR =
  '拒绝写入：内容包含「[已省略 … 数据（N 字符）…]」或「[已截断 …]」占位。这是框架替换掉的内嵌二进制数据，不是文件原文，写入会损坏文件。'
  + '请只用 edit_file 修改不含内嵌数据的部分，或用复制命令处理原文件。';

/**
 * Assistant text is model-authored and can itself carry inline binary (a copied or invented
 * `data:` / base64 media segment). Wherever earlier assistant text goes back to a model, or into
 * history without a confirmed delivery, it passes through {@link omitInlineBinaryForModel} first.
 * Returns the same object when nothing changed.
 */
export function omitInlineBinaryInAssistantMessage<T extends AgentMessage>(message: T): T {
  if (message.role !== 'assistant') return message;
  const assistant = message as AssistantMessage;
  let changed = false;
  const content = assistant.content.map(block => {
    if (block.type !== 'text') return block;
    const text = omitInlineBinaryForModel(block.text);
    if (text === block.text) return block;
    changed = true;
    return { ...block, text };
  });
  return changed ? { ...assistant, content } as T : message;
}

/** {@link omitInlineBinaryInAssistantMessage} over a message list (same array when nothing changed). */
export function omitInlineBinaryInAssistantMessages<T extends AgentMessage>(messages: T[]): T[];
export function omitInlineBinaryInAssistantMessages<T extends AgentMessage>(messages: readonly T[]): readonly T[];
export function omitInlineBinaryInAssistantMessages<T extends AgentMessage>(messages: readonly T[]): readonly T[] {
  let changed = false;
  const out = messages.map(message => {
    const next = omitInlineBinaryInAssistantMessage(message);
    if (next !== message) changed = true;
    return next;
  });
  return changed ? out : messages;
}

function omitInlineBinaryInContextMessage(message: AgentMessage): AgentMessage {
  if (message.role === 'assistant') return omitInlineBinaryInAssistantMessage(message);
  if (message.role !== 'user') return message;
  const user = message as UserMessage;
  if (typeof user.content === 'string') {
    const text = omitInlineBinaryForModel(user.content);
    return text === user.content ? message : { ...user, content: text } as AgentMessage;
  }
  let changed = false;
  const content = user.content.map(block => {
    if (block.type !== 'text') return block;
    const text = omitInlineBinaryForModel(block.text);
    if (text === block.text) return block;
    changed = true;
    return { ...block, text };
  });
  return changed ? { ...user, content } as AgentMessage : message;
}

/**
 * A completion port whose requests carry no inline binary in user / assistant text. For internal
 * completions that re-send earlier turn text as a transcript (compaction summaries), where the
 * agent loop's `convertToLlm` projection does not apply.
 */
export function omitInlineBinaryInCompletions(transport: LlmCompletionPort): LlmCompletionPort {
  const strip = (context: Context): Context => ({ ...context, messages: context.messages.map(omitInlineBinaryInContextMessage) });
  return {
    complete: (model, context, options) => transport.complete(model, strip(context), options),
    completeSimple: (model, context, options) => transport.completeSimple(model, strip(context), options),
  };
}

/**
 * #1250 第 29 批审查：框架自己写给模型 / 历史的占位，模型照抄进回复时不发给用户。只认这些固定形态：
 * - {@link omitInlineBinaryForModel}：`[已省略 … 数据（N 字符），未提供给模型]` / `[已截断 … 数据（N 字符），…]`；
 * - 已发送媒体（`sentInlineMediaPlaceholder`）：`[语音 mp3 18.6KB 已发送]`、`[图片 image/png 3.1KB 已发送]`；
 * - 文本投影（`renderAgentOutput`）：`[语音（内嵌数据，已省略）]`、`[文件: a.pdf（内嵌数据，已省略）]`、
 *   `[图片: 生成的图片（image/png 3.1KB）]`。
 * 普通文字（含其他方括号内容）不受影响。
 */
const FRAMEWORK_PLACEHOLDERS = new RegExp([
  /\[已(?:省略|截断) [^[\]\n]{0,80}数据（\d+ 字符）[^[\]\n]{0,120}\]/u.source,
  /\[(?:语音|图片|视频|文件)(?: [\w.+/-]{1,80})?(?: \d+(?:\.\d)?(?:B|KB|MB))? 已发送\]/u.source,
  /\[(?:图片|语音|视频|文件: [^[\]\n]{1,120})（内嵌数据，已省略）\]/u.source,
  /\[图片: 生成的图片（[\w.+/-]{1,80} \d+(?:\.\d)?(?:B|KB|MB)）\]/u.source,
].join('|'), 'gu');
/** Starts of the placeholders above; an unfinished streamed tail that may become one is held back. */
const PLACEHOLDER_HEADS = ['[已省略', '[已截断', '[语音', '[图片', '[视频', '[文件'];

/** Remove framework placeholders the model copied into reply text (see {@link FRAMEWORK_PLACEHOLDERS}). */
export function stripFrameworkPlaceholders(text: string): string {
  return text.includes('[') ? text.replace(FRAMEWORK_PLACEHOLDERS, '') : text;
}

/**
 * Streaming: strip complete placeholders and hold back an unfinished tail that could still turn
 * into one, so a placeholder is never offered to the platform piece by piece.
 */
export function stripFrameworkPlaceholdersInStream(text: string, complete: boolean): string {
  const stripped = stripFrameworkPlaceholders(text);
  if (complete) return stripped;
  const open = stripped.lastIndexOf('[');
  if (open < 0) return stripped;
  const tail = stripped.slice(open);
  if (tail.length > 240 || tail.includes(']') || tail.includes('\n')) return stripped;
  const pending = PLACEHOLDER_HEADS.some(head => head.startsWith(tail) || tail.startsWith(head));
  return pending ? stripped.slice(0, open) : stripped;
}

function textOf(segment: Segment): string | undefined {
  if (segment.type !== 'text' && segment.type !== 'markdown') return undefined;
  const value = (segment.data as Readonly<Record<string, unknown>> | undefined)?.[segment.type === 'text' ? 'text' : 'content'];
  return typeof value === 'string' ? value : undefined;
}

/** A text / markdown segment with placeholders stripped; `null` when only placeholders (and blanks) were left. */
export function stripFrameworkPlaceholdersInSegment(segment: Segment, complete = true): Segment | null {
  const text = textOf(segment);
  if (text === undefined) return segment;
  const next = complete ? stripFrameworkPlaceholders(text) : stripFrameworkPlaceholdersInStream(text, false);
  if (next === text) return segment;
  if (complete && !next.trim()) return null;
  return { ...segment, data: { ...segment.data, [segment.type === 'text' ? 'text' : 'content']: next } } as Segment;
}

/** Outbound reply elements with copied framework placeholders removed (empty texts / messages dropped). */
export function stripFrameworkPlaceholdersInOutput(elements: AgentOutputElement[]): AgentOutputElement[] {
  let changed = false;
  const out: AgentOutputElement[] = [];
  for (const element of elements) {
    if (element.type === 'message') {
      const segments = element.segments.flatMap(segment => {
        const next = stripFrameworkPlaceholdersInSegment(segment);
        if (next !== segment) changed = true;
        return next ? [next] : [];
      });
      if (segments.length) out.push(segments.length === element.segments.length && segments.every((s, i) => s === element.segments[i]) ? element : { ...element, segments });
      continue;
    }
    if (element.type === 'text') {
      const content = stripFrameworkPlaceholders(element.content);
      if (content !== element.content) {
        changed = true;
        if (content.trim()) out.push({ ...element, content });
        continue;
      }
    }
    out.push(element);
  }
  return changed ? out : elements;
}
