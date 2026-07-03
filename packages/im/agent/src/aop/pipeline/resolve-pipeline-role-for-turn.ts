/**
 * 解析当前 turn 的 Five-Agent pipelineRole（Cell 成员 SSOT，binding 名回退）。
 */
import type { Message } from '@zhin.js/core';
import type { ResolvedAgentBinding } from '../../config/types.js';
import { findCellMemberByEndpoint } from '../../collaboration/collaboration-config.js';
import { resolveCollaborationCellForMessage } from '../../collaboration/collaboration-context.js';
import { isPipelineRole, type PipelineRole } from '../../collaboration/types.js';

export function resolvePipelineRoleForTurn(
  activeBinding: ResolvedAgentBinding | null | undefined,
  commMessage?: Message,
): PipelineRole | undefined {
  if (commMessage) {
    const cell = resolveCollaborationCellForMessage(commMessage);
    if (cell) {
      const member = findCellMemberByEndpoint(cell, String(commMessage.$endpoint ?? ''));
      if (member?.pipelineRole && isPipelineRole(member.pipelineRole)) {
        return member.pipelineRole;
      }
    }
  }
  const name = activeBinding?.name;
  if (isPipelineRole(name)) return name;
  return undefined;
}
