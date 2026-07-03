/**
 * 协作群出站解析 — 委托 core ZhinAiOutboundPayload；cell roster 语义保留在此。
 */
import type { OutputElement } from '@zhin.js/ai';
import type { Message, MessageElement } from '@zhin.js/core';
import {
  AI_OUTBOUND_JSON_EXAMPLE,
  buildAiOutboundPromptHint,
  parseAiOutboundJson,
  type ZhinAiOutboundPayload,
} from '@zhin.js/core';
import { resolvePeerEndpointInCell } from './collaboration-config.js';
import { resolveCollaborationCellForMessage } from './collaboration-context.js';
import type { CollaborationCell } from './types.js';
import { isCellToolResultJson, removeEmbeddedCellToolJsonFromText } from './collaboration-delegation.js';
import { buildAtMessageContent, sendGroupMessageContent, sendGroupMessageFromEndpoint, resolvePlatformAtId, type GroupMessageAdapterView } from './group-message.js';
import { getHostRootPlugin } from '@zhin.js/core';
import {
  tryResolveStructuredAiOutbound,
  type TryResolveStructuredAiOutboundOptions,
} from './structured-ai-outbound.js';

/** @deprecated 使用 ZhinAiOutboundPayload */
export type CollaborationReplyPayload = ZhinAiOutboundPayload & { text: string };

export const COLLABORATION_MENTION_JSON_EXAMPLE = AI_OUTBOUND_JSON_EXAMPLE;

export const COLLABORATION_REPLY_JSON_HINT = buildAiOutboundPromptHint({
  forceJsonOnly: true,
});

export function resolveMentionEndpointIds(
  cell: import('./types.js').CollaborationCell,
  mentions: string[] | undefined,
): { ok: true; endpointIds: string[] } | { ok: false; error: string } {
  if (!mentions?.length) {
    return { ok: false, error: 'mentions 不能为空' };
  }
  const endpointIds: string[] = [];
  for (const ref of mentions) {
    const resolved = resolvePeerEndpointInCell(cell, ref);
    if (!resolved) {
      const roster = cell.members
        .map((m) => `${m.endpointId}${m.pipelineRole ? `(${m.pipelineRole})` : ''}`)
        .join(', ');
      return { ok: false, error: `未知 peer "${ref}"，可用 roster: ${roster}` };
    }
    if (!endpointIds.includes(resolved)) endpointIds.push(resolved);
  }
  return { ok: true, endpointIds };
}

export function buildCollaborationMentionSegmentsFromPayload(
  message: Message,
  payload: ZhinAiOutboundPayload,
): MessageElement[] | null {
  const cell = resolveCollaborationCellForMessage(message);
  if (!cell) return null;

  const adapter = resolveAdapterView(message);
  if (!adapter) return null;

  if (!payload.mentions?.length) {
    const text = payload.text?.trim() ?? '';
    if (!text) return null;
    return [{ type: 'text', data: { text } }];
  }

  const resolved = resolveMentionEndpointIds(cell, payload.mentions);
  if (!resolved.ok) return null;

  const text = payload.text?.trim() ?? '';
  if (!text) return null;

  return buildAtMessageContent(adapter, resolved.endpointIds, text);
}

/** 发送协作 JSON @ 消息（普通回复解析与 group_delegate 共用）。 */
export async function sendCollaborationMentionPayload(
  message: Message,
  payload: ZhinAiOutboundPayload,
): Promise<{ ok: boolean; error?: string; endpointIds?: string[] }> {
  const cell = resolveCollaborationCellForMessage(message);
  if (!cell) return { ok: false, error: '不在协作 Cell 群场景' };

  const text = payload.text?.trim() ?? '';
  if (!text) return { ok: false, error: '消息正文为空' };

  if (!payload.mentions?.length) {
    const sent = await sendGroupMessageFromEndpoint({ message, text });
    return sent.ok ? { ok: true, endpointIds: [] } : sent;
  }

  const resolved = resolveMentionEndpointIds(cell, payload.mentions);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const segments = buildCollaborationMentionSegmentsFromPayload(message, payload);
  if (!segments) return { ok: false, error: '无法构建 @ 消息段' };

  const sent = await sendGroupMessageContent({ message, content: segments });
  return sent.ok
    ? { ok: true, endpointIds: resolved.endpointIds }
    : sent;
}

function segmentAtUserId(seg: { type: string; data?: Record<string, unknown> }): string {
  if (seg.type !== 'at' && seg.type !== 'mention') return '';
  const data = seg.data;
  if (!data) return '';
  const raw = data.user_id ?? data.qq ?? data.id;
  return raw == null ? '' : String(raw);
}

function collectPeerMentionTokens(
  cell: CollaborationCell,
  selfEndpointId: string,
  adapter?: GroupMessageAdapterView,
): Set<string> {
  const tokens = new Set<string>();
  for (const member of cell.members) {
    if (member.endpointId === selfEndpointId) continue;
    tokens.add(member.endpointId);
    if (member.primary) tokens.add(member.primary);
    if (member.pipelineRole) tokens.add(member.pipelineRole);
    if (member.role) tokens.add(member.role);
    if (adapter) {
      tokens.add(resolvePlatformAtId(adapter, member.endpointId));
    }
  }
  return tokens;
}

function stripPlainMentionTokens(text: string, tokens: Set<string>): string {
  let out = text;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`@${escaped}(?=\\s|$|[，。！？,.!?])`, 'gi'), '');
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * 剥离出站消息里对 Cell peer 的 @（假 @ 与 at segment）。
 * Pipeline harness 等场景下委派由 harness 代发，Planner 正文不应携带 peer @。
 */
export function stripCellPeerMentionsFromSegments(
  segments: MessageElement[],
  cell: CollaborationCell,
  selfEndpointId: string,
  adapter?: GroupMessageAdapterView,
): MessageElement[] {
  const peerTokens = collectPeerMentionTokens(cell, selfEndpointId, adapter);
  const peerEndpointIds = new Set(
    cell.members.filter((m) => m.endpointId !== selfEndpointId).map((m) => m.endpointId),
  );
  const out: MessageElement[] = [];

  for (const seg of segments) {
    if (seg.type === 'at' || seg.type === 'mention') {
      const uid = segmentAtUserId(seg as { type: string; data?: Record<string, unknown> });
      if (uid && (peerEndpointIds.has(uid) || peerTokens.has(uid))) continue;
      out.push(seg);
      continue;
    }
    if (seg.type === 'text' && seg.data?.text != null) {
      const stripped = stripPlainMentionTokens(String(seg.data.text), peerTokens);
      if (!stripped) continue;
      out.push({
        type: 'text',
        data: { text: stripped.startsWith(' ') ? stripped : ` ${stripped}` },
      });
      continue;
    }
    out.push(seg);
  }
  return out;
}

function collectSelfMentionTokens(
  cell: CollaborationCell,
  selfEndpointId: string,
  adapter?: GroupMessageAdapterView,
): Set<string> {
  const member = cell.members.find((m) => m.endpointId === selfEndpointId);
  if (!member) return new Set();
  const tokens = new Set<string>([member.endpointId]);
  if (member.primary) tokens.add(member.primary);
  if (member.pipelineRole) tokens.add(member.pipelineRole);
  if (member.role) tokens.add(member.role);
  if (adapter) tokens.add(resolvePlatformAtId(adapter, member.endpointId));
  return tokens;
}

/** 剥离出站里对自身的 @（模型误 @ 自己的 endpoint/QQ）。 */
export function stripCellSelfMentionsFromSegments(
  segments: MessageElement[],
  cell: CollaborationCell,
  selfEndpointId: string,
  adapter?: GroupMessageAdapterView,
): MessageElement[] {
  const selfTokens = collectSelfMentionTokens(cell, selfEndpointId, adapter);
  const selfIds = new Set([selfEndpointId]);
  const out: MessageElement[] = [];
  for (const seg of segments) {
    if (seg.type === 'at' || seg.type === 'mention') {
      const uid = segmentAtUserId(seg as { type: string; data?: Record<string, unknown> });
      if (uid && (selfIds.has(uid) || selfTokens.has(uid))) continue;
      out.push(seg);
      continue;
    }
    if (seg.type === 'text' && seg.data?.text != null) {
      const stripped = stripPlainMentionTokens(String(seg.data.text), selfTokens);
      if (!stripped) continue;
      out.push({
        type: 'text',
        data: { text: stripped.startsWith(' ') ? stripped : ` ${stripped}` },
      });
      continue;
    }
    out.push(seg);
  }
  return out;
}

/** Planner 公开正文：剥离 peer 假 @ 与 self @。 */
export function stripPlannerPublicMentionsFromSegments(
  segments: MessageElement[],
  cell: CollaborationCell,
  selfEndpointId: string,
  adapter?: GroupMessageAdapterView,
): MessageElement[] {
  let out = stripCellPeerMentionsFromSegments(segments, cell, selfEndpointId, adapter);
  out = stripCellSelfMentionsFromSegments(out, cell, selfEndpointId, adapter);
  return out;
}

export function batchHasAtSegment(batch: MessageElement[]): boolean {
  return batch.some((seg) => seg.type === 'at' || seg.type === 'mention');
}

/** 协作群内模型「不回应/内心独白」类出站 — 不应广播到 IM。 */
export function isCollaborationNoOpReasoningOutbound(batches: MessageElement[][]): boolean {
  if (batches.some((batch) => batchHasAtSegment(batch))) return false;
  const text = batches
    .flat()
    .filter((seg) => seg.type === 'text' && seg.data?.text != null)
    .map((seg) => String(seg.data!.text))
    .join(' ')
    .trim();
  if (!text) return true;
  return /should not respond|stay silent|not directed at me|i'?ll stay silent|这是.*回复.*不是.*我|不应.*回应|无需.*回复/i.test(text);
}

function collectEndpointMentionTokens(
  endpointId: string,
  adapter?: GroupMessageAdapterView,
  cell?: CollaborationCell,
): Set<string> {
  const tokens = new Set<string>([endpointId]);
  const member = cell?.members.find((m) => m.endpointId === endpointId);
  if (member?.primary) tokens.add(member.primary);
  if (member?.pipelineRole) tokens.add(member.pipelineRole);
  if (member?.role) tokens.add(member.role);
  if (adapter) tokens.add(resolvePlatformAtId(adapter, endpointId));
  return tokens;
}

/** 出站 segments 是否包含对指定 endpoint 的真实 @ segment。 */
export function segmentsMentionEndpoint(
  segments: MessageElement[],
  endpointId: string,
  adapter?: GroupMessageAdapterView,
  cell?: CollaborationCell,
): boolean {
  const tokens = collectEndpointMentionTokens(endpointId, adapter, cell);
  for (const seg of segments) {
    if (seg.type !== 'at' && seg.type !== 'mention') continue;
    const uid = segmentAtUserId(seg as { type: string; data?: Record<string, unknown> });
    if (uid && tokens.has(uid)) return true;
  }
  return false;
}

/**
 * Pipeline 被委派方出站：只保留公开正文，剥离模型 JSON handback（post-turn harness 代发 @）。
 */
export function sanitizeCellToolJsonInOutboundBatches(
  batches: MessageElement[][],
): MessageElement[][] {
  const kept: MessageElement[][] = [];
  for (const batch of batches) {
    const cleaned = batch
      .map((seg) => {
        if (seg.type !== 'text' || seg.data?.text == null) return seg;
        const raw = String(seg.data.text);
        if (isCellToolResultJson(raw.trim())) return null;
        const text = removeEmbeddedCellToolJsonFromText(raw);
        if (!text.trim()) return null;
        if (text === raw) return seg;
        return {
          type: 'text' as const,
          data: { text: text.startsWith(' ') ? text : ` ${text}` },
        };
      })
      .filter((seg): seg is MessageElement => seg != null);
    if (cleaned.length) kept.push(cleaned);
  }
  return kept;
}

export function parseCollaborationReplyJson(raw: string): CollaborationReplyPayload | null {
  const parsed = parseAiOutboundJson(raw);
  if (!parsed?.text?.trim()) return null;
  return { ...parsed, text: parsed.text.trim() };
}

/** group_delegate 扩展 JSON（requireArtifact / artifactKinds / mode）。 */
export interface GroupDelegatePayload extends CollaborationReplyPayload {
  requireArtifact: boolean;
  artifactKinds?: import('./types.js').PipelineArtifactKind[];
  mode?: import('./types.js').ActiveDelegationMode;
}

function parseGroupDelegateFields(obj: Record<string, unknown>): GroupDelegatePayload | null {
  const mentions = Array.isArray(obj.mentions)
    ? obj.mentions.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    : undefined;
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!text) return null;
  if (typeof obj.requireArtifact !== 'boolean') return null;
  const artifactKinds = Array.isArray(obj.artifactKinds)
    ? obj.artifactKinds.filter(
      (k): k is import('./types.js').PipelineArtifactKind =>
        typeof k === 'string'
        && ['report', 'blueprint', 'deliverable', 'review', 'citations'].includes(k),
    )
    : undefined;
  const mode = obj.mode === 'ceremony' || obj.mode === 'pipeline' ? obj.mode : undefined;
  return { mentions, text, requireArtifact: obj.requireArtifact, artifactKinds, mode };
}

export function parseGroupDelegatePayload(raw: string): GroupDelegatePayload | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
  return parseGroupDelegateFields(obj);
}

/**
 * 兼容 LLM 工具调用：message=JSON 字符串 | message=对象 | 顶层扁平字段。
 */
export function coerceGroupDelegateArgs(args: Record<string, unknown>): GroupDelegatePayload | null {
  const msg = args.message;
  if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
    return parseGroupDelegateFields(msg as Record<string, unknown>);
  }
  const hasFlat = args.mentions != null
    || (typeof args.text === 'string' && args.text.trim().length > 0)
    || typeof args.requireArtifact === 'boolean';
  if (hasFlat) {
    return parseGroupDelegateFields(args);
  }
  if (typeof msg === 'string' && msg.trim()) {
    return parseGroupDelegatePayload(msg);
  }
  return null;
}

function resolveAdapterView(message: Message): GroupMessageAdapterView | undefined {
  const plugin = getHostRootPlugin();
  if (!plugin) return undefined;
  return plugin.inject(message.$adapter) as GroupMessageAdapterView | undefined;
}

/**
 * 将协作 JSON / 假 @ 回复转为带真实 @ segment 的 MessageElement[]。
 */
export async function tryBuildCollaborationMentionSegments(
  message: Message,
  elements: OutputElement[],
  options: TryResolveStructuredAiOutboundOptions = {},
): Promise<MessageElement[] | null> {
  return tryResolveStructuredAiOutbound(message, elements, options);
}

export { tryBuildCollaborationOutboundBatches } from './structured-ai-outbound.js';
