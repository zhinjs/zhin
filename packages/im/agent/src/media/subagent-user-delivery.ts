/**
 * 子 agent 完成后的用户可见文案。
 *
 * 说明：日志里的 `{image}` 来自 @zhin.js/core `segment.raw()`，表示本条消息含真实
 * image 段（与 `{reply}` 同类），不是未替换的占位符。正文里若模型重复写了 `{image}`，
 * 且 toolCalls 已含 generate_image，则从文字中去掉以免与图片段重复。
 */
import { compactMediaToolJsonForModel, type AgentResult } from '@zhin.js/ai';
import type { ToolCallRecord } from '../zhin-agent/tool-calls-user-format.js';
import { extractMediaElementsFromToolCalls } from './media-tool-bridge.js';
import type { SubagentOutboundDelivery } from './deliver-subagent-result.js';

const REDUNDANT_MEDIA_TOKEN_RE = /\{image\}|\{audio\}|\{video\}|\{record\}/gi;
const OMITTED_B64_RE = /\[omitted[^\]]*base64[^\]]*\]/gi;
const MEDIA_TOOL_LINE_RE = /^【(generate_image|voice_tts)】\s*(.+)$/;

/** 子 agent 正文中嵌入的巨型媒体工具 JSON（出站走 toolCalls，勿塞进文本模板） */
export function stripEmbeddedMediaToolJson(text: string): string {
  return text.split('\n').map((line) => {
    const m = line.match(MEDIA_TOOL_LINE_RE);
    if (!m) return line;
    const [, tool, payload] = m;
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
    out = out.replace(REDUNDANT_MEDIA_TOKEN_RE, '');
  }
  return out
    .replace(OMITTED_B64_RE, '')
    .replace(/图片已发送给用户[。.!]?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface BuildSubagentUserDeliveryParams {
  label: string;
  status: 'ok' | 'error';
  result: string;
  toolCalls: AgentResult['toolCalls'];
}

export function buildSubagentUserDelivery(
  params: BuildSubagentUserDeliveryParams,
): SubagentOutboundDelivery {
  const toolCalls = params.toolCalls as ToolCallRecord[];
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
