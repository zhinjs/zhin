/**
 * 子 agent 完成后的用户可见文案。
 *
 * 说明：日志里的 `{image}` 来自 @zhin.js/core `segment.raw()`，表示本条消息含真实
 * image 段（与 `{reply}` 同类），不是未替换的占位符。正文里若模型重复写了 `{image}`，
 * 且 toolCalls 已含 generate_image，则从文字中去掉以免与图片段重复。
 */
import { compactMediaToolJsonForModel } from '@zhin.js/ai';
import type { ToolCallRecord } from '../core/tool-calls-user-format.js';
import { extractMediaElementsFromToolCalls } from './media-tool-bridge.js';
import type { SubagentOutboundDelivery } from './deliver-subagent-result.js';

/** 子 agent 正文中嵌入的巨型媒体工具 JSON（出站走 toolCalls，勿塞进文本模板） */
export function stripEmbeddedMediaToolJson(text: string): string {
  return text.split('\n').map((line) => {
    const parsed = parseMediaToolLine(line);
    if (!parsed) return line;
    const { tool, payload } = parsed;
    const trimmed = payload.trim();
    if (trimmed.startsWith('Error:')) return line;
    if (!trimmed.startsWith('{')) return line;
    return `【${tool}】${compactMediaToolJsonForModel(tool, trimmed)}`;
  }).join('\n');
}

/** 模型正文中与已出站媒体重复的 token（不影响 MessageElement 图片段） */
export function stripRedundantMediaTokensFromText(text: string, opts: { hasOutboundMedia: boolean }): string {
  let out = text;
  if (opts.hasOutboundMedia) {
    out = stripRedundantMediaTokens(out);
  }
  return collapseBlankLines(stripSentImageNotice(stripOmittedBase64(out))).trim();
}

function parseMediaToolLine(line: string): { tool: 'generate_image' | 'voice_tts'; payload: string } | null {
  if (!line.startsWith('【')) return null;
  const end = line.indexOf('】');
  if (end < 0) return null;
  const tool = line.slice(1, end);
  if (tool !== 'generate_image' && tool !== 'voice_tts') return null;
  return { tool, payload: line.slice(end + 1).trimStart() };
}

function stripRedundantMediaTokens(text: string): string {
  return ['{image}', '{audio}', '{video}', '{record}'].reduce(
    (acc, token) => acc.replaceAll(token, ''),
    text,
  );
}

function stripOmittedBase64(text: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.toLowerCase().indexOf('[omitted', cursor);
    if (start < 0) break;
    const end = text.indexOf(']', start + 1);
    if (end < 0) break;
    const body = text.slice(start, end + 1).toLowerCase();
    out += text.slice(cursor, start);
    if (!body.includes('base64')) out += text.slice(start, end + 1);
    cursor = end + 1;
  }
  return out + text.slice(cursor);
}

function stripSentImageNotice(text: string): string {
  return text.replaceAll('图片已发送给用户。', '').replaceAll('图片已发送给用户.', '').replaceAll('图片已发送给用户!', '').replaceAll('图片已发送给用户', '');
}

function collapseBlankLines(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let blank = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blank++;
      if (blank <= 2) out.push(line);
    } else {
      blank = 0;
      out.push(line);
    }
  }
  return out.join('\n');
}

export interface BuildSubagentUserDeliveryParams {
  label: string;
  status: 'ok' | 'error';
  result: string;
  toolCalls: ToolCallRecord[];
}

export function buildSubagentUserDelivery(
  params: BuildSubagentUserDeliveryParams,
): SubagentOutboundDelivery {
  const toolCalls = params.toolCalls;
  const media = extractMediaElementsFromToolCalls(toolCalls);
  const hasImage = media.some(e => e.type === 'image');
  const hasAudio = media.some(e => e.type === 'audio');
  const clean = stripRedundantMediaTokensFromText(
    stripEmbeddedMediaToolJson(params.result),
    { hasOutboundMedia: media.length > 0 },
  );

  if (params.status === 'error') {
    const body = clean || '子任务执行失败';
    return { text: `【${params.label}】未能完成\n\n${body}`, toolCalls };
  }

  if (hasImage) {
    const caption = clean && !/已成功|已生成|已发送/i.test(clean) && clean.length < 120
      ? clean
      : `【${params.label}】画好了～`;
    return { text: caption, toolCalls };
  }

  if (hasAudio) {
    return { text: clean ? `【${params.label}】\n\n${clean}` : `【${params.label}】语音已生成`, toolCalls };
  }

  const body = clean.length > 500 ? `${clean.slice(0, 500)}…` : (clean || '任务已完成');
  return { text: `【${params.label}】完成\n\n${body}`, toolCalls };
}
