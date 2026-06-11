/**
 * Mission milestone IM delivery (ADR 0011 D7).
 */
import { createSyntheticMessage, type SendOptions } from '@zhin.js/core';
import type { SubagentOrigin } from '../subagent.js';

export interface ParsedSessionKey {
  platform: string;
  endpointId: string;
  scope: 'private' | 'group' | 'channel';
  sceneId: string;
}

/** Parse `platform:endpointId:scope:sceneId` session keys. */
export function parseOrchestrationSessionKey(sessionKey: string): ParsedSessionKey | null {
  const parts = sessionKey.split(':');
  if (parts.length < 4) return null;
  const [platform, endpointId, scopeRaw, ...rest] = parts;
  const scope = scopeRaw === 'group' || scopeRaw === 'channel' ? scopeRaw : 'private';
  const sceneId = rest.join(':');
  if (!platform || !endpointId || !sceneId) return null;
  return { platform, endpointId, scope, sceneId };
}

export function formatMissionMilestoneMessage(
  kind: string,
  runId: string,
  message: string,
): string {
  const labels: Record<string, string> = {
    mission_complete: 'Mission 完成',
    mission_failed: 'Mission 失败',
    mission_started: 'Mission 已启动',
    mission_spec_gate_failed: 'Spec 门禁失败',
  };
  const title = labels[kind] ?? 'Mission 里程碑';
  return `[${title}] run=${runId}\n${message}`;
}

export function sessionKeyToSubagentOrigin(sessionKey: string): SubagentOrigin | null {
  const parsed = parseOrchestrationSessionKey(sessionKey);
  if (!parsed) return null;
  return {
    message: createSyntheticMessage({
      adapter: parsed.platform,
      endpoint: parsed.endpointId,
      sender: { id: 'mission-milestone' },
      channel: { type: parsed.scope, id: parsed.sceneId },
    }),
  };
}

export async function deliverMissionMilestoneIm(
  sessionKey: string,
  kind: string,
  runId: string,
  message: string,
  send: (options: SendOptions) => Promise<string>,
): Promise<boolean> {
  const parsed = parseOrchestrationSessionKey(sessionKey);
  if (!parsed) return false;
  const text = formatMissionMilestoneMessage(kind, runId, message);
  await send({
    context: parsed.platform,
    endpoint: parsed.endpointId,
    id: parsed.sceneId,
    type: parsed.scope,
    content: text,
  });
  return true;
}
