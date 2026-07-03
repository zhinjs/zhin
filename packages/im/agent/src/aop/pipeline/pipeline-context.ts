/**
 * Pipeline turn 上下文（ADR 0024）：按当前 endpoint 的 pipelineRole + stage 动态注入。
 * 仅在命中多角色协作 Cell 时返回；否则 undefined（不污染普通会话）。
 */
import type { Message } from '@zhin.js/core';
import { resolveCellForScene, findCellMemberByEndpoint } from '../../collaboration/collaboration-config.js';
import { readCollaborationTurnSnapshot } from '../../collaboration/collaboration-turn-snapshot.js';
import { PIPELINE_ROLE_LABELS } from '../../config/resolve-pipeline-binding.js';
import type { CollaborationScene } from '../../collaboration/types.js';

function rosterLines(cell: CollaborationScene, selfEndpoint: string): string[] {
  const lines: string[] = ['Cell roster:'];
  for (const m of cell.members) {
    const tag = m.endpointId === selfEndpoint ? ' (you)' : '';
    const role = m.pipelineRole ? PIPELINE_ROLE_LABELS[m.pipelineRole] : (m.role ?? m.primary);
    lines.push(`- ${m.endpointId}: ${role}${tag}`);
  }
  return lines;
}

/** 命中协作 Cell 且当前 endpoint 为成员时，返回 pipeline 上下文提示。 */
export function resolvePipelineTurnHint(
  message: Message | undefined,
  options?: { omitRoster?: boolean },
): string | undefined {
  if (!message) return undefined;
  const scope = message.$channel?.type;
  if (scope !== 'group' && scope !== 'channel') return undefined;
  const sceneId = message.$channel?.id;
  if (!sceneId) return undefined;
  const endpointId = String(message.$endpoint ?? '');
  const cell = resolveCellForScene(
    String(message.$adapter ?? ''),
    sceneId,
  );
  if (!cell || cell.members.length < 2) return undefined;
  const self = findCellMemberByEndpoint(cell, endpointId);
  if (!self) return undefined;

  const lines: string[] = ['[Five-Agent pipeline]', `Cell: ${cell.id}`];
  if (cell.goal?.trim()) lines.push(`Goal: ${cell.goal.trim()}`);
  if (self.pipelineRole) {
    lines.push(`Your role: ${PIPELINE_ROLE_LABELS[self.pipelineRole]}`);
  }
  const state = cell.pipelineState;
  const snap = readCollaborationTurnSnapshot(message);
  const turnRunId = snap?.delegationRunId ?? snap?.runId;
  if (state) {
    if (state.runLabel?.trim()) lines.push(`Flow label: ${state.runLabel.trim()}`);
    if (turnRunId) {
      const activeNote = turnRunId !== state.runId ? ` (turn-bound; active=${state.runId})` : '';
      lines.push(`Run: ${turnRunId}${activeNote} (cell_read_artifact only returns THIS run unless runId=)`);
    } else {
      lines.push(`Run: ${state.runId} (cell_read_artifact only returns THIS run)`);
    }
    if (state.userGoal?.trim()) {
      lines.push(`Pipeline userGoal (authoritative — ignore unrelated chat history): ${state.userGoal.trim()}`);
    }
    lines.push(`Stage: ${state.stage} (review cycle ${state.reviewCycles}/${state.maxReviewCycles})`);
    if (state.allowedNextStages.length) {
      lines.push(`Allowed next: ${state.allowedNextStages.join(', ')}`);
    }
  }
  if (!options?.omitRoster) {
    lines.push(...rosterLines(cell, endpointId));
  }
  lines.push('SSOT: cell_pipeline_status + cell_read_artifact(runId); prior group chat may be stale after reset.');
  return lines.join('\n');
}
