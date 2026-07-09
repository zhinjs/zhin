/**
 * 协作出站 SSOT — parse → planner role strategy → JSON 失败兜底 → delivery 扩展。
 */
import type { OutputElement } from '@zhin.js/ai';
import type { Message, MessageElement } from '@zhin.js/core';
import {
  readMentionSegmentTarget,
  extractEmbeddedAiOutboundJson,
  parseAiOutboundJson,
  rewritePlainTextMentions,
} from '@zhin.js/core';
import type { CollaborationScene, PipelineRole } from './types.js';
import { tryBuildCollaborationOutboundBatches } from './structured-ai-outbound.js';
import { expandOutboundBatchesForLongText, buildAtMessageContent, type GroupMessageAdapterView } from './group-message.js';
import { publishOutboundElements } from '../media/media-publisher.js';
import { resolvePeerEndpointInCell } from './collaboration-config.js';
import {
  stripPlannerPublicMentionsFromSegments,
  batchHasAtSegment,
  segmentsMentionEndpoint,
} from './collaboration-outbound.js';

export interface OutboundBatchMeta {
  fallback?: string;
  peerTriggerExpected: boolean;
}

export interface ResolveOutboundBatchesInput {
  message: Message;
  elements: OutputElement[];
  inboundContent?: string;
  cell?: CollaborationScene;
  endpointId: string;
  adapterView?: GroupMessageAdapterView;
  selfMember?: CollaborationScene['members'][number];
  warn?: (message: string) => void;
  root?: import('@zhin.js/core').Plugin;
}

export interface ResolveOutboundBatchesResult {
  batches: MessageElement[][];
  batchMeta: OutboundBatchMeta[];
  primaryFallback?: string;
}

/** 剥离正文中的假 @token，避免 JSON 解析失败时误触发 peer。 */
export function stripFakeAtTokens(text: string): string {
  return text
    .replace(/@[\w:.-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const PLANNER_PIPELINE_ROLES: PipelineRole[] = ['researcher', 'evaluator', 'executor', 'reviewer'];

function batchPlainText(batch: MessageElement[]): string {
  return batch
    .filter((seg) => seg.type === 'text' && seg.data?.text != null)
    .map((seg) => String(seg.data!.text).trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** 批次是否为对 peer 的真实 @ 委派。 */
export function isPlannerDelegateBatch(
  batch: MessageElement[],
  cell: CollaborationScene,
  selfEndpointId: string,
  adapter?: GroupMessageAdapterView,
): boolean {
  if (!batchHasAtSegment(batch)) return false;
  for (const member of cell.members) {
    if (member.endpointId === selfEndpointId) continue;
    if (segmentsMentionEndpoint(batch, member.endpointId, adapter, cell)) return true;
  }
  return false;
}

function resolveRoleCallInProse(
  text: string,
  cell: CollaborationScene,
): { role: PipelineRole; task: string } | undefined {
  for (const role of PLANNER_PIPELINE_ROLES) {
    const member = cell.members.find((m) => m.pipelineRole === role);
    if (!member) continue;
    const bold = new RegExp(`\\*\\*${role}\\*\\*[，,：:\\s]*(.+?)(?:[。！!]|$)`, 'i');
    const plain = new RegExp(`(?:^|[，。\\s])${role}[，,：]\\s*(?!的)(.+?)(?:[。！!]|$)`, 'i');
    const hit = text.match(bold) ?? text.match(plain);
    if (hit) {
      return { role, task: hit[1]!.trim() || `请 ${role} 继续处理。` };
    }
  }
  return undefined;
}

function buildDelegateBatch(
  adapter: GroupMessageAdapterView,
  endpointIds: string[],
  text: string,
): MessageElement[] {
  return buildAtMessageContent(adapter, endpointIds, text.trim() || '请处理。');
}

function splitProseIntoDelegateBatches(
  batch: MessageElement[],
  cell: CollaborationScene,
  selfEndpointId: string,
  adapter: GroupMessageAdapterView,
): MessageElement[][] {
  if (isPlannerDelegateBatch(batch, cell, selfEndpointId, adapter)) {
    return [batch];
  }

  const plain = batchPlainText(batch);
  if (!plain) return [batch];

  const embedded = extractEmbeddedAiOutboundJson(plain);
  if (embedded?.jsonRaw) {
    const payload = parseAiOutboundJson(embedded.jsonRaw);
    if (payload?.mentions?.length && payload.text?.trim()) {
      const ids: string[] = [];
      for (const ref of payload.mentions) {
        const ep = resolvePeerEndpointInCell(cell, ref);
        if (ep && ep !== selfEndpointId && !ids.includes(ep)) ids.push(ep);
      }
      if (ids.length) {
        const out: MessageElement[][] = [];
        if (embedded.prose.trim()) {
          out.push([{ type: 'text', data: { text: ` ${embedded.prose.trim()}` } }]);
        }
        out.push(buildDelegateBatch(adapter, ids, payload.text));
        return out;
      }
    }
  }

  const rewritten = rewritePlainTextMentions(plain, (ref) => {
    const ep = resolvePeerEndpointInCell(cell, ref);
    if (!ep || ep === selfEndpointId) return undefined;
    return ep;
  });
  if (rewritten?.mentions?.length && rewritten.text?.trim()) {
    const ids = rewritten.mentions
      .map((ref) => resolvePeerEndpointInCell(cell, ref))
      .filter((ep): ep is string => Boolean(ep && ep !== selfEndpointId));
    if (ids.length) {
      const out: MessageElement[][] = [];
      if (rewritten.text.trim()) {
        out.push([{ type: 'text', data: { text: ` ${rewritten.text.trim()}` } }]);
      }
      out.push(buildDelegateBatch(adapter, ids, rewritten.text));
      return out;
    }
  }

  const roleCall = resolveRoleCallInProse(plain, cell);
  if (roleCall) {
    const ep = cell.members.find((m) => m.pipelineRole === roleCall.role)?.endpointId;
    if (ep && ep !== selfEndpointId) {
      const withoutCall = plain
        .replace(new RegExp(`\\*\\*${roleCall.role}\\*\\*[^。！!]*`, 'i'), '')
        .trim();
      const out: MessageElement[][] = [];
      if (withoutCall) {
        out.push([{ type: 'text', data: { text: ` ${withoutCall}` } }]);
      }
      out.push(buildDelegateBatch(adapter, [ep], roleCall.task));
      return out;
    }
  }

  return [batch];
}

/** Planner 出站 role strategy：拆分委派 @、剥离 self 假 @，不删除真实委派 batch。 */
export function normalizePlannerOutboundBatches(
  batches: MessageElement[][],
  cell: CollaborationScene,
  selfEndpointId: string,
  adapter: GroupMessageAdapterView,
): MessageElement[][] {
  const expanded: MessageElement[][] = [];
  for (const batch of batches) {
    expanded.push(...splitProseIntoDelegateBatches(batch, cell, selfEndpointId, adapter));
  }

  const normalized: MessageElement[][] = [];
  for (const batch of expanded) {
    if (isPlannerDelegateBatch(batch, cell, selfEndpointId, adapter)) {
      normalized.push(batch);
      continue;
    }
    const stripped = stripPlannerPublicMentionsFromSegments(batch, cell, selfEndpointId, adapter);
    if (stripped.length) normalized.push(stripped);
  }
  return normalized;
}

function canonicalizeMentionSegments(batch: MessageElement[]): MessageElement[] {
  return batch.map((seg) => {
    if (seg.type !== 'at') return seg;
    const target = readMentionSegmentTarget(seg) ?? seg.data?.id ?? seg.data?.qq;
    if (!target) return seg;
    return { type: 'mention', data: { target: String(target) } };
  });
}

function batchHasMention(batch: MessageElement[]): boolean {
  return batch.some((seg) => seg.type === 'mention' || seg.type === 'at');
}

export async function resolveOutboundBatches(
  input: ResolveOutboundBatchesInput,
): Promise<ResolveOutboundBatchesResult> {
  const {
    message,
    elements,
    inboundContent,
    cell,
    endpointId,
    adapterView,
    selfMember,
    warn,
  } = input;

  const collabBatches = await tryBuildCollaborationOutboundBatches(message, elements, {
    inboundContent,
    warn,
    root: input.root,
  });

  let batches: MessageElement[][] = collabBatches ?? [
    await publishOutboundElements(elements, String(message.$adapter)),
  ];

  if (cell && selfMember?.pipelineRole === 'planner' && adapterView) {
    batches = normalizePlannerOutboundBatches(batches, cell, endpointId, adapterView);
  }

  batches = batches
    .map((batch) => canonicalizeMentionSegments(batch))
    .filter((batch) => batch.length > 0);

  const batchMeta: OutboundBatchMeta[] = batches.map((batch) => ({
    peerTriggerExpected: batchHasMention(batch),
  }));

  if (!batches.length && elements.length) {
    const plain = elements
      .filter((el) => el.type === 'text')
      .map((el) => (el.type === 'text' ? el.content : ''))
      .join('\n')
      .trim();
    if (plain) {
      const prose = stripFakeAtTokens(plain);
      if (prose) {
        batches = [[{ type: 'text', data: { text: prose } }]];
        batchMeta.push({ fallback: 'json_parse_failed_strip_at', peerTriggerExpected: false });
        warn?.(`outbound JSON parse failed; stripped fake @ tokens, prose only`);
      }
    }
  }

  batches = expandOutboundBatchesForLongText(batches);

  return {
    batches,
    batchMeta,
    primaryFallback: batchMeta.find((m) => m.fallback)?.fallback,
  };
}
