/**
 * Mission milestone IM delivery (ADR 0011 D7).
 */
import type { SendOptions } from '@zhin.js/core';
import type { SubagentOrigin } from '../subagent.js';

export interface ParsedSessionKey {
  platform: string;
  botId: string;
  scope: 'private' | 'group' | 'channel';
  sceneId: string;
}

/** Parse `platform:botId:scope:sceneId` session keys. */
export function parseOrchestrationSessionKey(sessionKey: string): ParsedSessionKey | null {
  const parts = sessionKey.split(':');
  if (parts.length < 4) return null;
  const [platform, botId, scopeRaw, ...rest] = parts;
  const scope = scopeRaw === 'group' || scopeRaw === 'channel' ? scopeRaw : 'private';
  const sceneId = rest.join(':');
  if (!platform || !botId || !sceneId) return null;
  return { platform, botId, scope, sceneId };
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
    platform: parsed.platform,
    botId: parsed.botId,
    sceneId: parsed.sceneId,
    senderId: 'mission-milestone',
    sceneType: parsed.scope,
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
    bot: parsed.botId,
    id: parsed.sceneId,
    type: parsed.scope,
    content: text,
  });
  return true;
}
