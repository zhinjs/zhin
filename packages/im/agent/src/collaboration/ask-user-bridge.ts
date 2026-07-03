/**
 * 群协作场景下 ask_user 与 kernel 委派的衔接。
 */
import type { Message } from '@zhin.js/core';
import { resolveCellForScene } from './collaboration-config.js';
import {
  publishCollaborationGroupFeed,
  resolveActorPipelineRole,
} from './group-feed.js';

/** 群内禁止用 ask_user 向 Owner 申请「委派授权」——应走 OrchestrationKernel / spawn_task。 */
export function shouldBlockDelegationAskUser(
  commMessage: Message,
  question: string,
  questionType: string,
): string | undefined {
  const scope = commMessage.$channel?.type;
  if (scope !== 'group' && scope !== 'channel') return undefined;
  const sceneId = commMessage.$channel?.id;
  if (!sceneId) return undefined;
  const cell = resolveCellForScene(
    String(commMessage.$adapter ?? ''),
    sceneId,
  );
  if (!cell || cell.members.length < 2) return undefined;
  const q = question.trim();
  if (questionType !== 'confirm') return undefined;
  if (/授权|authorize|是否.*(调用|使用|委派|派遣)|allow.*(researcher|executor|delegate|agent)/i.test(q)) {
    return 'Error: In group collaboration, do not ask_owner to authorize delegation. Use orchestration_add_task (group_mention) or spawn_task with the peer endpoint.';
  }
  if (/Researcher|Evaluator|Executor|Reviewer/i.test(q) && /是否|authorize|授权|调用/i.test(q)) {
    return 'Error: In group collaboration, dispatch peers via OrchestrationKernel (group_mention task) — do not ask_owner for role authorization.';
  }
  return undefined;
}

export function buildGroupAskUserFollowUp(commMessage: Message, answer: string): string {
  const scope = commMessage.$channel?.type;
  if (scope !== 'group' && scope !== 'channel') return answer;
  const sceneId = commMessage.$channel?.id;
  if (!sceneId) return answer;
  const cell = resolveCellForScene(
    String(commMessage.$adapter ?? ''),
    sceneId,
  );
  if (!cell || cell.members.length < 2) return answer;

  const peer = cell.members.find((m) => m.endpointId !== String(commMessage.$endpoint));
  const peerEp = peer?.endpointId ?? '<peerEndpoint>';
  const roleLabel = peer?.pipelineRole ?? peer?.primary ?? 'next peer';

  return [
    answer,
    '',
    `[Collaboration] Owner replied via private. Active scene: group ${sceneId}.`,
    `Next: orchestration_add_task with executor group_mention assigned_to ${peerEp}, or spawn_task for local work (${roleLabel}).`,
    'Peer @ assignments must include #taskId in the outbound text.',
    'Do NOT answer from memory or skip kernel task dispatch.',
  ].join('\n');
}

export async function notifyGroupOwnerAskUserResolved(
  commMessage: Message,
  answer: string,
): Promise<void> {
  const scope = commMessage.$channel?.type;
  if (scope !== 'group' && scope !== 'channel') return;
  await publishCollaborationGroupFeed({
    message: commMessage,
    role: resolveActorPipelineRole(commMessage),
    emoji: '✅',
    headline: 'Owner 已确认',
    detail: answer,
  });
}
