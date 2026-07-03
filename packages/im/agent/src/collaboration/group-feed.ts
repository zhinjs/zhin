/**
 * 群协作可见动态 — ADR 0024 D4「IM @ + 短摘要」的工程化落地。
 *
 * 用户在群里应能看到：计划、委派、阶段推进、各角色产出摘要。
 * 全文仍存 Artifact DB；群 feed 长摘要分段连发，不截断省略。
 */
import type { Message } from '@zhin.js/core';
import { resolveCellForScene, findCellMemberByEndpoint } from './collaboration-config.js';
import { sendGroupMessageFromEndpoint } from './group-message.js';
import {
  isPipelineRole,
  type PipelineArtifactKind,
  type PipelineRole,
  type PipelineStage,
} from './types.js';

/** 群 feed 用中文角色名（与 binding nickname 解耦）。 */
const ROLE_FEED_LABELS_ZH: Record<PipelineRole, string> = {
  planner: '规划员',
  researcher: '调研员',
  evaluator: '评估员',
  executor: '执行员',
  reviewer: '评审员',
};

const ARTIFACT_KIND_LABELS_ZH: Record<PipelineArtifactKind, string> = {
  report: '调研报告',
  blueprint: '决策蓝图',
  deliverable: '交付物',
  review: '评审结论',
  citations: '引用清单',
};

const STAGE_LABELS_ZH: Record<string, string> = {
  planner: '规划',
  researcher: '调研',
  evaluator: '评估',
  executor: '执行',
  reviewer: '评审',
  done: '完成',
  failed: '失败',
};

function isMultiBotGroupScene(message: Message): boolean {
  const scope = message.$channel?.type;
  if (scope !== 'group' && scope !== 'channel') return false;
  const sceneId = message.$channel?.id;
  if (!sceneId) return false;
  const cell = resolveCellForScene(
    String(message.$adapter ?? ''),
    sceneId,
  );
  return !!cell && cell.members.length >= 2;
}

export function formatRoleFeedLabel(role?: PipelineRole): string {
  if (role && isPipelineRole(role)) return ROLE_FEED_LABELS_ZH[role];
  return '协作者';
}

function payloadHasContent(payload: Record<string, unknown>): boolean {
  return Object.values(payload).some((v) => {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v as object).length > 0;
    return true;
  });
}

function isMeaninglessFeedDetail(detail: string | undefined): boolean {
  if (!detail?.trim()) return true;
  const t = detail.trim();
  if (t === '{}' || t === '[]') return true;
  if (t.startsWith('{') && t.endsWith('}')) {
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      return !payloadHasContent(o);
    } catch {
      return false;
    }
  }
  return false;
}

export function formatArtifactSubmitFeedHeadline(kind: PipelineArtifactKind): string {
  return `已提交${ARTIFACT_KIND_LABELS_ZH[kind]}`;
}

export function formatArtifactFeedSummary(
  kind: PipelineArtifactKind,
  payload: Record<string, unknown>,
): string | undefined {
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const v = payload[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  };

  if (!payloadHasContent(payload)) return undefined;

  switch (kind) {
    case 'report':
      return pick('summary', 'title', 'headline', 'text');
    case 'blueprint':
      return pick('decision', 'summary', 'recommendation');
    case 'deliverable':
      return pick('summary', 'title', 'path', 'description');
    case 'review': {
      const approved = payload.approved === true;
      const feedback = pick('feedback', 'comments', 'reason', 'summary');
      if (feedback) return approved ? `通过：${feedback}` : `需修改：${feedback}`;
      return approved ? '评审通过' : '评审未通过';
    }
    case 'citations': {
      const items = payload.items ?? payload.citations;
      const count = Array.isArray(items) ? items.length : undefined;
      return count != null ? `${count} 条引用` : pick('summary');
    }
    default:
      return undefined;
  }
}

export interface PublishGroupFeedInput {
  message: Message;
  role?: PipelineRole;
  emoji?: string;
  headline: string;
  detail?: string;
  /** 单条 IM 分段长度上限（默认 4000）；超长 detail 由 sendGroupMessageFromEndpoint 连发 */
  maxChars?: number;
}

/** 发布一条群可见协作动态（纯文本，无 @）。 */
export async function publishCollaborationGroupFeed(
  input: PublishGroupFeedInput,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (!isMultiBotGroupScene(input.message)) {
    return { ok: true, skipped: true };
  }
  const label = formatRoleFeedLabel(input.role);
  const prefix = input.emoji ? `${input.emoji} ` : '';
  const detail = isMeaninglessFeedDetail(input.detail) ? undefined : input.detail!.trim();
  const body = detail
    ? `${prefix}${label}${input.headline}：${detail}`
    : `${prefix}${label}${input.headline}`;
  const sent = await sendGroupMessageFromEndpoint({
    message: input.message,
    text: body,
    maxChars: input.maxChars,
  });
  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}

export function formatDelegationFeedText(
  fromRole: PipelineRole | undefined,
  toRole: PipelineRole | undefined,
  task: string,
): string {
  const from = formatRoleFeedLabel(fromRole);
  const to = formatRoleFeedLabel(toRole);
  return `${from} → ${to}：${task.trim()}`;
}

export function formatStageFeedText(from: PipelineStage, to: PipelineStage): string {
  const fromLabel = STAGE_LABELS_ZH[from] ?? from;
  const toLabel = STAGE_LABELS_ZH[to] ?? to;
  return `阶段推进：${fromLabel} → ${toLabel}`;
}

export function resolveActorPipelineRole(message: Message): PipelineRole | undefined {
  const sceneId = message.$channel?.id;
  if (!sceneId) return undefined;
  const cell = resolveCellForScene(
    String(message.$adapter ?? ''),
    sceneId,
  );
  if (!cell) return undefined;
  const member = findCellMemberByEndpoint(cell, String(message.$endpoint ?? ''));
  return member?.pipelineRole && isPipelineRole(member.pipelineRole)
    ? member.pipelineRole
    : undefined;
}
