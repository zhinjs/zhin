import type { SessionBranchPoint } from '@zhin.js/ai';
import { beginTurnSession, type SessionIODeps } from '../session/session-io.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
function formatBranchList(points: SessionBranchPoint[]): string {
  if (points.length === 0) return '当前会话无 user 分支点';
  return points
    .map(p => `${p.index}. ${p.preview}`)
    .join('\n');
}

export async function listSessionTree(
  host: ZhinAgentPrivate,
  sessionKey: string,
): Promise<string> {
  const deps: SessionIODeps = {
    agentSessionStore: host.agentSessionStore,
    contextRepository: host.contextRepository,
  };
  const { sessionId } = await beginTurnSession(deps, sessionKey);
  const points = await host.contextRepository.listBranchPoints(sessionId);
  return `🌳 会话分支点（/tree N 跳转，/fork N 从该点继续）：\n${formatBranchList(points)}`;
}

export async function jumpSessionTree(
  host: ZhinAgentPrivate,
  sessionKey: string,
  index: number,
): Promise<string> {
  const deps: SessionIODeps = {
    agentSessionStore: host.agentSessionStore,
    contextRepository: host.contextRepository,
  };
  const { sessionId } = await beginTurnSession(deps, sessionKey);
  const result = await host.contextRepository.jumpToBranchIndex(sessionId, index);
  return result.ok ? `✅ ${result.message}` : `ℹ️ ${result.message}`;
}
