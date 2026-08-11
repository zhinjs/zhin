/**
 * collaboration 纯函数/常量（无依赖模块；commands/wizard/observe/gate 共用，
 * 打破 collaboration-commands ↔ init-wizard-service 与 init-observe-hook ↔ collab-admin-gate 循环）。
 */

import type { Message } from '@zhin.js/core';
import type { CollaborationScene } from './types.js';

/** 默认 cell id（<adapter>:<sceneId>）。 */
export function defaultCellId(adapter: string, sceneId: string): string {
  return `${adapter}:${sceneId}`;
}

/** 从 at 消息段提取平台 id（兼容 qq / user_id / id）。 */
export function atSegmentPlatformId(
  data: Record<string, unknown> | undefined,
): string | undefined {
  if (!data) return undefined;
  for (const key of ['qq', 'user_id', 'id'] as const) {
    const value = data[key];
    if (value != null && String(value).trim() !== '') {
      return String(value);
    }
  }
  return undefined;
}

/** 提取消息中 at segment 的 target id 列表。 */
export function extractAtTargets(message: Message): string[] {
  const targets: string[] = [];
  for (const el of message.$content ?? []) {
    if (el.type !== 'at') continue;
    const id = atSegmentPlatformId(el.data as Record<string, unknown> | undefined);
    if (id) targets.push(id);
  }
  return targets;
}

/** cell 中 planner 角色的 endpoint id。 */
export function resolvePlannerEndpointId(cell: CollaborationScene): string | undefined {
  return cell.members.find((m) => m.pipelineRole === 'planner')?.endpointId;
}
