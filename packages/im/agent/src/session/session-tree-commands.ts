import type { Locale } from '@zhin.js/plugin-runtime';
import { managementMessages as t } from '../init/management-messages.js';
import { managementCommandReference, type AgentCommandPresentation } from '../init/command-presentation.js';
import type { SessionBranchPoint } from '@zhin.js/ai';
import { beginTurnSession, type SessionIODeps } from '../session/session-io.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
function formatBranchList(points: SessionBranchPoint[], locale?: Locale): string {
  if (points.length === 0) return t(locale, 'noBranches');
  return points
    .map(p => `${p.index}. ${p.preview}`)
    .join('\n');
}

export async function listSessionTree(
  host: ZhinAgentPrivate,
  sessionKey: string,
  presentation: AgentCommandPresentation = {},
): Promise<string> {
  const deps: SessionIODeps = {
    agentSessionStore: host.agentSessionStore,
    contextRepository: host.contextRepository,
  };
  const { sessionId } = await beginTurnSession(deps, sessionKey);
  const points = await host.contextRepository.listBranchPoints(sessionId);
  const tree = managementCommandReference('tree', presentation.commandPrefix);
  const fork = managementCommandReference('fork', presentation.commandPrefix);
  const hint = tree !== undefined && fork !== undefined ? t(presentation.locale, 'branchHint', { tree, fork }) : '';
  return `${t(presentation.locale, 'branches')}${hint}\n${formatBranchList(points, presentation.locale)}`;
}

export async function jumpSessionTree(
  host: ZhinAgentPrivate,
  sessionKey: string,
  index: number,
  locale?: Locale,
): Promise<string> {
  const deps: SessionIODeps = {
    agentSessionStore: host.agentSessionStore,
    contextRepository: host.contextRepository,
  };
  const { sessionId } = await beginTurnSession(deps, sessionKey);
  const result = await host.contextRepository.jumpToBranchIndex(sessionId, index);
  const message = result.code ? t(locale, result.code, { index, preview: result.preview ?? '' }) : result.message;
  return result.ok ? `✅ ${message}` : `ℹ️ ${message}`;
}
