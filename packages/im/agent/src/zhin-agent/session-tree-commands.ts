import { resolveIMSessionIdFromToolContext } from '@zhin.js/ai';
import type { SessionBranchPoint } from '@zhin.js/ai';
import type { ToolContext } from '@zhin.js/core';
import { beginTurnSession, type SessionIODeps } from './session-io.js';
import type { ZhinAgentPrivate } from './zhin-agent-private.js';

function formatBranchList(points: SessionBranchPoint[]): string {
  if (points.length === 0) return '当前会话无 user 分支点';
  return points
    .map(p => `${p.index}. ${p.preview}`)
    .join('\n');
}

export async function listSessionTreeForContext(
  host: ZhinAgentPrivate,
  context: ToolContext,
): Promise<string> {
  const sessionKey = resolveIMSessionIdFromToolContext({
    platform: context.platform,
    botId: context.botId,
    scope: context.scope,
    sceneId: context.sceneId,
    senderId: context.senderId,
  });
  const deps: SessionIODeps = {
    imSessionStore: host.imSessionStore,
    agentSessionStore: host.agentSessionStore,
    contextRepository: host.contextRepository,
  };
  const { sessionId } = await beginTurnSession(deps, sessionKey, context);
  const points = await host.contextRepository.listBranchPoints(sessionId);
  return `🌳 会话分支点（/tree N 跳转，/fork N 从该点继续）：\n${formatBranchList(points)}`;
}

export async function jumpSessionTreeForContext(
  host: ZhinAgentPrivate,
  context: ToolContext,
  index: number,
): Promise<string> {
  const sessionKey = resolveIMSessionIdFromToolContext({
    platform: context.platform,
    botId: context.botId,
    scope: context.scope,
    sceneId: context.sceneId,
    senderId: context.senderId,
  });
  const deps: SessionIODeps = {
    imSessionStore: host.imSessionStore,
    agentSessionStore: host.agentSessionStore,
    contextRepository: host.contextRepository,
  };
  const { sessionId } = await beginTurnSession(deps, sessionKey, context);
  const result = await host.contextRepository.jumpToBranchIndex(sessionId, index);
  return result.ok ? `✅ ${result.message}` : `ℹ️ ${result.message}`;
}
