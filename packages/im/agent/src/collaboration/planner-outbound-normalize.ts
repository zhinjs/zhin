/**
 * Planner 出站归一化：假 @ / 角色呼名 → 独立 @ 批次；保留真实委派 batch。
 */
import type { MessageElement } from '@zhin.js/core';
import {
  extractEmbeddedAiOutboundJson,
  parseAiOutboundJson,
  rewritePlainTextMentions,
} from '@zhin.js/core';
import type { CollaborationCell, PipelineRole } from './types.js';
import { resolvePeerEndpointInCell } from './collaboration-config.js';
import { buildAtMessageContent, type GroupMessageAdapterView } from './group-message.js';
import { stripPlannerPublicMentionsFromSegments, batchHasAtSegment, segmentsMentionEndpoint } from './collaboration-outbound.js';

const PIPELINE_ROLES: PipelineRole[] = ['researcher', 'evaluator', 'executor', 'reviewer'];

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
  cell: CollaborationCell,
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
  cell: CollaborationCell,
): { role: PipelineRole; task: string } | undefined {
  for (const role of PIPELINE_ROLES) {
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
  cell: CollaborationCell,
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

/** Planner 出站：拆分委派 @、剥离 self 假 @，不删除真实委派 batch。 */
export function normalizePlannerOutboundBatches(
  batches: MessageElement[][],
  cell: CollaborationCell,
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
