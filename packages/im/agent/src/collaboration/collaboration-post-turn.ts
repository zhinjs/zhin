/**
 * Collaboration post-turn harness — 仅 handback 兜底（artifact 门控通过后）。
 */
import type { Message, MessageElement, Plugin } from '@zhin.js/core';
import { formatCompactLog } from '@zhin.js/logger';
import type { CollaborationCell, PipelineState } from './types.js';
import { getCollaborationCellService } from './cell-service.js';
import { resolveCellForScene } from './collaboration-config.js';
import type { GroupMessageAdapterView } from './group-message.js';
import { sendGroupPeerMention } from './im-mention-delegate.js';
import { segmentsMentionEndpoint } from './collaboration-outbound.js';
import {
  isPipelineDelegateeTurn,
  resolvePlannerEndpointId,
  summarizeDelegateeReply,
} from './collaboration-delegation.js';
import { removeActiveDelegationForEndpoint, findActiveDelegation } from './delegation-state.js';
import { delegationArtifactsSatisfied } from './delegation-artifact-gate.js';
import { readCollaborationTurnSnapshot } from './collaboration-turn-snapshot.js';
import {
  isCeremonyActive,
  isSubstantiveCeremonyPublicReply,
  recordCeremonySpoken,
  assignCeremonyDelegate,
  resolveNextCeremonyEndpointId,
  ceremonyPingText,
} from './ceremony-round.js';

export {
  messageTextContent,
  resolvePlannerEndpointId,
  isPipelineDelegateeTurn,
  isPlannerPipelineDelegation,
  summarizeDelegateeReply,
  formatActiveDelegationHint,
} from './collaboration-delegation.js';

export function extractTurnResultSummary(segments: MessageElement[] | undefined): string {
  if (!segments?.length) return '已完成。';
  const text = segments
    .filter((seg) => seg.type === 'text' && seg.data?.text != null)
    .map((seg) => String(seg.data!.text).trim())
    .filter(Boolean)
    .join(' ');
  return summarizeDelegateeReply(text);
}

export function formatHandbackText(summary: string): string {
  const trimmed = summary.trim() || '已完成。';
  return trimmed.startsWith('已完成') ? trimmed : `已完成：${trimmed}`;
}

export interface EnsurePipelineHandbackInput {
  message: Message;
  cell: CollaborationCell;
  speakerEndpointId: string;
  outboundSegments?: MessageElement[];
  /** 实际发到 IM 的 segments（用于判断是否已 @ Planner；勿与过滤前 raw 混淆） */
  sentOutboundSegments?: MessageElement[];
  adapter?: GroupMessageAdapterView;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  /** post-turn 已清委派后调用，跳过 isPipelineDelegateeTurn 门控 */
  skipDelegateeGate?: boolean;
}

export async function ensurePipelineHandbackToPlanner(
  input: EnsurePipelineHandbackInput,
): Promise<boolean> {
  const {
    message,
    cell,
    speakerEndpointId,
    outboundSegments,
    sentOutboundSegments,
    adapter,
    logger,
    skipDelegateeGate,
  } = input;
  const plannerId = resolvePlannerEndpointId(cell);
  if (!plannerId || speakerEndpointId === plannerId) return true;
  if (!skipDelegateeGate && !isPipelineDelegateeTurn(cell, speakerEndpointId)) return true;

  const gate = await delegationArtifactsSatisfied(cell, speakerEndpointId);
  if (!gate.ok) {
    logger.warn(formatCompactLog('CollaborationPostTurn', {
      stage: 'pipeline_harness',
      action: 'handback_blocked_artifacts',
      cell: cell.id,
      from: speakerEndpointId,
      missing: gate.missing?.join(',') ?? 'unknown',
    }));
    return false;
  }

  const mentionSegments = sentOutboundSegments ?? outboundSegments;
  if (
    mentionSegments
    && adapter
    && segmentsMentionEndpoint(mentionSegments, plannerId, adapter, cell)
  ) {
    return true;
  }

  const summarySource = sentOutboundSegments ?? outboundSegments;
  const summary = extractTurnResultSummary(summarySource);
  const text = formatHandbackText(summary);
  const speakerMessage = { ...message, $endpoint: speakerEndpointId } as Message;
  const sent = await sendGroupPeerMention({
    message: speakerMessage,
    targetEndpointId: plannerId,
    text,
  });

  if (!sent.ok) {
    logger.warn(formatCompactLog('CollaborationPostTurn', {
      stage: 'pipeline_harness',
      action: 'handback_failed',
      cell: cell.id,
      from: speakerEndpointId,
      to: plannerId,
      error: sent.error,
    }));
    return false;
  }

  logger.info(formatCompactLog('CollaborationPostTurn', {
    stage: 'pipeline_harness',
    action: 'handback',
    cell: cell.id,
    from: speakerEndpointId,
    to: plannerId,
    text,
  }));
  return true;
}

/** 以 Planner Endpoint 身份向成员发送真实 @ 委派。 */
export async function sendPipelineDelegation(
  contextMessage: Message,
  cell: CollaborationCell,
  targetEndpointId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const plannerEndpointId = resolvePlannerEndpointId(cell);
  if (!plannerEndpointId) {
    return { ok: false, error: 'cell_has_no_planner' };
  }
  const plannerMessage = { ...contextMessage, $endpoint: plannerEndpointId } as Message;
  return sendGroupPeerMention({ message: plannerMessage, targetEndpointId, text });
}

export interface ProcessCollaborationPostTurnInput {
  message: Message;
  cell?: CollaborationCell;
  endpointId: string;
  inboundContent: string;
  outboundOk: boolean;
  outboundSegments?: MessageElement[];
  /** 过滤后实际广播到群的 segments（handback @ 检测 SSOT） */
  sentOutboundSegments?: MessageElement[];
  adapter?: GroupMessageAdapterView;
  root: Plugin;
  logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; debug?: (...a: unknown[]) => void };
}

export async function resolveCollaborationCellForMessage(
  message: Message,
): Promise<CollaborationCell | undefined> {
  const scope = message.$channel?.type;
  if (scope !== 'group' && scope !== 'channel') return undefined;
  const sceneId = message.$channel?.id;
  if (sceneId == null || sceneId === '') return undefined;
  const adapter = String(message.$adapter ?? '');
  const svc = getCollaborationCellService();
  let hit = resolveCellForScene(adapter, String(sceneId));
  if (!hit) {
    await svc.reloadFromRepository();
    hit = resolveCellForScene(adapter, String(sceneId));
  }
  if (!hit) return undefined;
  return (await svc.getCellFresh(hit.id)) ?? hit;
}

async function clearDelegationAfterHandback(
  cellId: string,
  endpointId: string,
  runId?: string,
): Promise<void> {
  const svc = getCollaborationCellService();
  await svc.patchPipelineState(cellId, (prev) => {
    if (!prev) return undefined;
    const nextDelegations = removeActiveDelegationForEndpoint(
      prev.activeDelegations,
      endpointId,
      runId,
    );
    if (nextDelegations.length === (prev.activeDelegations?.length ?? 0)) {
      return undefined;
    }
    return {
      ...prev,
      activeDelegations: nextDelegations.length ? nextDelegations : undefined,
      pendingDelegateTarget: undefined,
      updatedAt: Date.now(),
    };
  });
}

async function notifyPlannerArtifactBlocked(input: {
  message: Message;
  cell: CollaborationCell;
  speakerEndpointId: string;
  missing: string[];
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}): Promise<void> {
  const plannerId = resolvePlannerEndpointId(input.cell);
  if (!plannerId) return;
  const missing = input.missing.join(', ') || 'unknown';
  const text = `委派未完成：缺少产物 ${missing}。请 cell_submit_artifact 提交后再交还。`;
  const sent = await sendGroupPeerMention({
    message: { ...input.message, $endpoint: input.speakerEndpointId } as Message,
    targetEndpointId: plannerId,
    text,
  });
  if (!sent.ok) {
    input.logger.warn(formatCompactLog('CollaborationPostTurn', {
      stage: 'pipeline_harness',
      action: 'handback_blocked_notify_failed',
      cell: input.cell.id,
      from: input.speakerEndpointId,
      to: plannerId,
      error: sent.error,
    }));
    return;
  }
  input.logger.info(formatCompactLog('CollaborationPostTurn', {
    stage: 'pipeline_harness',
    action: 'handback_blocked_notify_planner',
    cell: input.cell.id,
    from: input.speakerEndpointId,
    to: plannerId,
    missing,
  }));
}

/** AI turn 出站后：被委派方 handback 兜底（artifact 门控 + 清除 activeDelegation）。 */
export async function processCollaborationPostTurn(
  input: ProcessCollaborationPostTurnInput,
): Promise<void> {
  const { message, endpointId, outboundOk, outboundSegments, adapter, logger } = input;
  const fresh = (await resolveCollaborationCellForMessage(message)) ?? input.cell;
  if (!fresh || fresh.members.length < 2) {
    logger.info(formatCompactLog('CollaborationPostTurn', {
      stage: 'pipeline_harness',
      action: 'post_turn_skip',
      reason: 'no_cell',
      endpoint: endpointId,
    }));
    return;
  }

  const pipeline = fresh.pipelineState;
  const activeCount = pipeline?.activeDelegations?.length ?? 0;

  logger.info(formatCompactLog('CollaborationPostTurn', {
    stage: 'pipeline_harness',
    action: 'post_turn',
    cell: fresh.id,
    endpoint: endpointId,
    outboundOk,
    pipelineStage: pipeline?.stage ?? 'none',
    activeDelegations: activeCount,
  }));

  if (!isPipelineDelegateeTurn(fresh, endpointId)) return;

  const snap = readCollaborationTurnSnapshot(message);
  const delegationRunId = snap?.delegationRunId ?? snap?.runId;
  const delegation = findActiveDelegation(fresh, endpointId);
  const gate = await delegationArtifactsSatisfied(fresh, endpointId);

  if (!outboundOk) {
    logger.info(formatCompactLog('CollaborationPostTurn', {
      stage: 'pipeline_harness',
      action: 'post_turn_skip',
      reason: 'outbound_empty',
      cell: fresh.id,
      endpoint: endpointId,
    }));
    return;
  }

  if (!gate.ok) {
    logger.warn(formatCompactLog('CollaborationPostTurn', {
      stage: 'pipeline_harness',
      action: 'handback_blocked_artifacts',
      cell: fresh.id,
      from: endpointId,
      missing: gate.missing?.join(',') ?? 'unknown',
    }));
    await notifyPlannerArtifactBlocked({
      message,
      cell: fresh,
      speakerEndpointId: endpointId,
      missing: gate.missing ?? [],
      logger,
    });
    return;
  }

  const isCeremonyTurn = delegation?.mode === 'ceremony'
    || (!delegation?.requireArtifact && isCeremonyActive(fresh));
  if (isCeremonyTurn) {
    const publicText = (input.sentOutboundSegments ?? outboundSegments ?? [])
      .filter((seg) => seg.type === 'text' && seg.data?.text != null)
      .map((seg) => String(seg.data!.text))
      .join(' ')
      .trim();
    if (!isSubstantiveCeremonyPublicReply(publicText)) {
      logger.info(formatCompactLog('CollaborationPostTurn', {
        stage: 'pipeline_harness',
        action: 'post_turn_skip',
        reason: 'ceremony_no_public_intro',
        cell: fresh.id,
        endpoint: endpointId,
      }));
      return;
    }
  }

  // 先清委派再 handback，避免 Planner 被 activeDelegations 门控挡掉
  await clearDelegationAfterHandback(fresh.id, endpointId, delegationRunId);

  const handbackOk = await ensurePipelineHandbackToPlanner({
    message,
    cell: fresh,
    speakerEndpointId: endpointId,
    outboundSegments,
    sentOutboundSegments: input.sentOutboundSegments,
    adapter,
    logger,
    skipDelegateeGate: true,
  });
  if (!handbackOk) return;

  if (isCeremonyTurn) {
    await recordCeremonySpoken(fresh.id, endpointId);
    const updated = (await getCollaborationCellService().getCellFresh(fresh.id)) ?? fresh;
    const nextId = resolveNextCeremonyEndpointId(updated, endpointId);
    if (nextId) {
      const ping = ceremonyPingText(updated, nextId);
      await assignCeremonyDelegate(updated, nextId, ping);
      const sent = await sendPipelineDelegation(message, updated, nextId, ping);
      logger.info(formatCompactLog('CollaborationPostTurn', {
        stage: 'ceremony_harness',
        action: 'advance_round',
        cell: fresh.id,
        from: endpointId,
        to: nextId,
        ok: sent.ok,
      }));
    } else {
      logger.info(formatCompactLog('CollaborationPostTurn', {
        stage: 'ceremony_harness',
        action: 'round_complete',
        cell: fresh.id,
        last: endpointId,
      }));
    }
  }
}
