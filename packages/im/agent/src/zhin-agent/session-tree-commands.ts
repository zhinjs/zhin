import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import type { SessionBranchPoint } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import { beginTurnSession, type SessionIODeps } from './session-io.js';
import type { ZhinAgentPrivate } from './zhin-agent-private.js';

function formatBranchList(points: SessionBranchPoint[]): string {
  if (points.length === 0) return '当前会话无 user 分支点';
  return points
    .map(p => `${p.index}. ${p.preview}`)
    .join('\n');
}

export async function listSessionTreeForCommMessage(
  host: ZhinAgentPrivate,
  commMessage: Message,
): Promise<string> {
  const sessionKey = resolveIMSessionIdFromMessage(commMessage);
  const deps: SessionIODeps = {
    imSessionStore: host.imSessionStore,
    agentSessionStore: host.agentSessionStore,
    contextRepository: host.contextRepository,
  };
  const { sessionId } = await beginTurnSession(deps, sessionKey, commMessage);
  const points = await host.contextRepository.listBranchPoints(sessionId);
  return `🌳 会话分支点（/tree N 跳转，/fork N 从该点继续）：\n${formatBranchList(points)}`;
}

export async function jumpSessionTreeForCommMessage(
  host: ZhinAgentPrivate,
  commMessage: Message,
  index: number,
): Promise<string> {
  const sessionKey = resolveIMSessionIdFromMessage(commMessage);
  const deps: SessionIODeps = {
    imSessionStore: host.imSessionStore,
    agentSessionStore: host.agentSessionStore,
    contextRepository: host.contextRepository,
  };
  const { sessionId } = await beginTurnSession(deps, sessionKey, commMessage);
  const result = await host.contextRepository.jumpToBranchIndex(sessionId, index);
  return result.ok ? `✅ ${result.message}` : `ℹ️ ${result.message}`;
}
