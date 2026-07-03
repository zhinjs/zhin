import type { Message } from '@zhin.js/core';
import {
  buildAiOutboundPromptHint,
  getAdapterAiOutboundCapabilities,
  getAdapterAiOutboundExtensions,
  getHostRootPlugin,
} from '@zhin.js/core';
import type { CollaborationCell } from './types.js';
import { resolveCellForScene, findCellMemberByEndpoint } from './collaboration-config.js';

/** 用户要求重来 / 重启 pipeline（Planner 应先 cell_reset_pipeline）。 */
export function detectPipelineRestartIntent(content: string | undefined): boolean {
  if (!content?.trim()) return false;
  return /重新(开始|启动|来)|从头开始|重来|再来一次|restart(?:\s+(?:the\s+)?(?:process|pipeline|run))?|new\s+run/i.test(content);
}

/** 仪式/轮流协作任务（自我介绍、依次发言等）— 不走调研 pipeline + 产物。 */
export function detectCeremonyOrchestrationIntent(content: string | undefined): boolean {
  if (!content?.trim()) return false;
  return /自我介绍|介绍一下自己|依次|轮流|按顺序|点名|round\s*robin|大家.{0,8}(说|发言|介绍|汇报)|组织大家/i.test(content);
}

/** 每轮 turn envelope 用的精简 Cell 提示（勿重复 buildAiOutboundPromptHint 长文）。 */
export function formatCollaborationTurnCellHint(
  cell: CollaborationCell,
  currentEndpointId: string,
): string {
  const self = findCellMemberByEndpoint(cell, currentEndpointId);
  const peers = cell.members.filter((m) => m.endpointId !== currentEndpointId);
  const peerBrief = peers
    .map((p) => `${p.primary}=${p.endpointId}`)
    .join(', ');
  const lines = [
    `[Cell ${cell.id}] You: ${self?.primary ?? currentEndpointId} (${currentEndpointId})`,
  ];
  if (cell.goal?.trim()) lines.push(`Goal: ${cell.goal.trim()}`);
  if (peerBrief) lines.push(`Peers: ${peerBrief}`);
  lines.push('Assignments and peer mentions are managed by the orchestration kernel.');
  lines.push('If this is a delegated task and the message includes #taskId, include that #taskId in your handback.');
  return lines.join('\n');
}

export function formatCollaborationCellHint(
  cell: CollaborationCell,
  currentEndpointId: string,
  options?: { forceJsonOnly?: boolean },
): string {
  const self = findCellMemberByEndpoint(cell, currentEndpointId);
  const peers = cell.members.filter((m) => m.endpointId !== currentEndpointId);
  const cellLines = [
    '[Collaboration cell]',
    `Cell: ${cell.id} (adapter ${cell.adapter}, scene ${cell.sceneId})`,
  ];
  if (cell.goal?.trim()) cellLines.push(`Goal: ${cell.goal.trim()}`);
  if (self) {
    cellLines.push(
      `You: endpoint ${currentEndpointId}, agent "${self.primary}"${self.role ? ` (${self.role})` : ''}.`,
    );
  }
  if (peers.length > 0) {
    cellLines.push('Peers:');
    for (const peer of peers) {
      cellLines.push(
        `- "${peer.endpointId}": agent "${peer.primary}"${peer.role ? ` (${peer.role})` : ''}`,
      );
    }
  }

  const plugin = getHostRootPlugin();
  const adapterInstance = plugin?.inject(cell.adapter) as object | undefined;
  const capabilities = adapterInstance
    ? getAdapterAiOutboundCapabilities(adapterInstance)
    : undefined;
  const extensions = adapterInstance
    ? getAdapterAiOutboundExtensions(adapterInstance)
    : undefined;

  const lines = [
    buildAiOutboundPromptHint({
      capabilities,
      extensions,
      rosterLines: cellLines,
      forceJsonOnly: options?.forceJsonOnly ?? false,
    }),
    'Assignments and task handback are managed by the orchestration kernel.',
    'Status: cell_mission_status.',
  ];
  return lines.join('\n');
}

/** 仅当入站消息命中多 Bot 协作 Cell 时返回 Cell（私聊、非成员、单 Bot Cell 均不注入）。 */
export function resolveCollaborationCellForMessage(
  message: Message | undefined,
): CollaborationCell | undefined {
  if (!message) return undefined;
  const scope = message.$channel?.type;
  if (scope !== 'group' && scope !== 'channel') return undefined;
  const sceneId = message.$channel?.id;
  if (!sceneId) return undefined;
  const endpointId = String(message.$endpoint ?? '');
  if (!endpointId) return undefined;

  const cell = resolveCellForScene(
    String(message.$adapter ?? ''),
    String(sceneId),
  );
  if (!cell || cell.members.length < 2) return undefined;
  if (!findCellMemberByEndpoint(cell, endpointId)) return undefined;
  return cell;
}

/** 构建 turn envelope 用的协作提示；不满足场景时返回 undefined。 */
export function resolveCollaborationTurnHint(
  message: Message | undefined,
  _inboundContent?: string,
): string | undefined {
  const cell = resolveCollaborationCellForMessage(message);
  if (!cell) return undefined;
  const endpointId = String(message!.$endpoint);
  const lines = [
    formatCollaborationTurnCellHint(cell, endpointId),
  ].filter(Boolean);
  return lines.join('\n');
}
