/**
 * Peer inbound trigger policy — prevent bot-to-bot chat storms.
 */

import type { Message, Plugin } from '@zhin.js/core';
import { isAtEndpoint, segment } from '@zhin.js/core';
import type { CollaborationCell, PeerTriggerMode, PeerTriggerResult } from './types.js';
import { resolveMemberBySender } from './endpoint-identity.js';

export interface PeerPolicyInput {
  message: Message;
  cell?: CollaborationCell;
  peerMode: PeerTriggerMode;
  endpointAtIds: string[];
  /** 用于 Endpoint 反查 peer 身份（缺省回退 getHostRootPlugin）。 */
  root?: Plugin;
}

export interface CellAtOwnershipResult {
  /** 当前 Endpoint 是否应处理这条入站（Cell 内仅被 @ 的成员响应） */
  shouldHandle: boolean;
  mentionedEndpointIds?: string[];
  reason?: string;
}

function segmentAtUserId(seg: { type: string; data?: Record<string, unknown> }): string {
  if (seg.type !== 'at' && seg.type !== 'mention') return '';
  const data = seg.data;
  if (!data) return '';
  const raw = data.user_id ?? data.qq ?? data.id;
  return raw == null ? '' : String(raw);
}

/** 按消息顺序收集 @ 到的 Cell 成员 endpointId */
export function resolveCellAtMentionedEndpointIds(
  message: Message,
  cell: CollaborationCell,
  root?: Plugin,
): string[] {
  const memberIds = new Set(cell.members.map((m) => m.endpointId));
  const ordered: string[] = [];
  const fromPeer = isInboundFromCollaborationPeer(message, cell, root);

  for (const seg of message.$content) {
    const uid = segmentAtUserId(seg as { type: string; data?: Record<string, unknown> });
    if (uid && memberIds.has(uid) && !ordered.includes(uid)) {
      ordered.push(uid);
      continue;
    }
    // Bot 纯文本里的 @endpoint 是「假 @」，不能触发 peer；仅人类入站才做文本兜底。
    if (!fromPeer && seg.type === 'text' && seg.data?.text) {
      const text = String(seg.data.text);
      for (const id of memberIds) {
        const re = new RegExp(`@${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
        if (re.test(text) && !ordered.includes(id)) ordered.push(id);
      }
    }
  }
  return ordered;
}

/** @deprecated 使用 resolveCellAtMentionedEndpointIds；保留首个 @ 以兼容旧调用 */
export function resolveCellAtWinnerEndpointId(
  message: Message,
  cell: CollaborationCell,
): string | undefined {
  return resolveCellAtMentionedEndpointIds(message, cell)[0];
}

/** 同群多 Bot：仅被 @ 的 Cell 成员响应；未 @ 任何成员时不触发 */
export function evaluateCellAtOwnership(
  message: Message,
  cell: CollaborationCell | undefined,
  endpointId: string,
  root?: Plugin,
): CellAtOwnershipResult {
  if (!cell) return { shouldHandle: true };

  const mentioned = resolveCellAtMentionedEndpointIds(message, cell, root);

  // Delegation ownership is owned by the OrchestrationKernel (ADR 0027):
  // active group_mention tasks, not cell.pipelineState. The inbound pipeline
  // resolves handback against kernel tasks directly, so this gate is purely
  // mention-based.

  if (mentioned.length === 0) {
    return {
      shouldHandle: false,
      mentionedEndpointIds: mentioned,
      reason: 'cell_mention_required',
    };
  }

  // Bot 编排消息 @ 多个成员时，只认消息序第一个（防 Planner @all 引发全员响应）
  if (mentioned.length > 1 && isInboundFromCollaborationPeer(message, cell, root)) {
    const winner = mentioned[0]!;
    if (endpointId !== winner) {
      return {
        shouldHandle: false,
        mentionedEndpointIds: mentioned,
        reason: 'peer_multi_mention_first_only',
      };
    }
    return { shouldHandle: true, mentionedEndpointIds: mentioned };
  }

  if (mentioned.includes(endpointId)) {
    return { shouldHandle: true, mentionedEndpointIds: mentioned };
  }
  return {
    shouldHandle: false,
    mentionedEndpointIds: mentioned,
    reason: 'cell_not_mentioned',
  };
}

export function evaluatePeerTrigger(input: PeerPolicyInput): PeerTriggerResult {
  const { message, cell, peerMode, endpointAtIds, root } = input;
  if (!cell) {
    return { isPeer: false, shouldTrigger: true };
  }

  const senderId = String(message.$sender?.id ?? '');
  const member = resolveMemberBySender(cell, senderId, root);
  if (!member) {
    return { isPeer: false, shouldTrigger: true };
  }

  if (peerMode === 'off') {
    return { isPeer: true, peerEndpointId: member.endpointId, shouldTrigger: true };
  }

  if (peerMode === 'mention-only') {
    const atSelf = isAtEndpoint(message, endpointAtIds);
    // 协作 Cell：peer 仅认真实 at segment，正文假 @ 不触发（与 harness 委派一致）。
    if (cell) {
      return {
        isPeer: true,
        peerEndpointId: member.endpointId,
        shouldTrigger: atSelf,
        reason: atSelf ? 'peer_mentioned' : 'peer_mention_required',
      };
    }
    const raw = segment.raw(message.$content).trim();
    const atInText = endpointAtIds.some((id) => raw.includes(`@${id}`));
    const shouldTrigger = atSelf || atInText;
    return {
      isPeer: true,
      peerEndpointId: member.endpointId,
      shouldTrigger,
      reason: shouldTrigger ? 'peer_mentioned' : 'peer_mention_required',
    };
  }

  return { isPeer: true, peerEndpointId: member.endpointId, shouldTrigger: true };
}

/** 入站是否来自同 Cell 的另一 Endpoint（Bot↔Bot 协作，非人类用户） */
export function isInboundFromCollaborationPeer(
  message: Message,
  cell: CollaborationCell | undefined,
  root?: Plugin,
): boolean {
  if (!cell) return false;
  const senderId = String(message.$sender?.id ?? '');
  if (!senderId) return false;
  return !!resolveMemberBySender(cell, senderId, root);
}
