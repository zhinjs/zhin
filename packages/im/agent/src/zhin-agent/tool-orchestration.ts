import { formatCompact, Logger } from '@zhin.js/logger';
import type { AgentTool } from '@zhin.js/ai';
import type { ToolContext } from '../orchestrator/types.js';
import { notifySubagentGoal } from '../subagent-goal-notify.js';
import { SessionManager } from '@zhin.js/ai';
import { buildOrchestratorAgentTools } from './tool-search-orchestrator.js';
import { filterToolsForToolSearchCatalog } from './tool-catalog.js';
import type { ZhinAgentPrivate } from './zhin-agent-private.js';

const logger = new Logger(null, 'ZhinAgent');

export function resolveAgentToolsForTurn(
  agent: ZhinAgentPrivate,
  allTools: AgentTool[],
  context: ToolContext,
): { tools: AgentTool[]; deferredStats?: string } {
  if (!agent.config.toolSearch) {
    return { tools: allTools };
  }
  const toolSearchPool = filterToolsForToolSearchCatalog(allTools);
  const built = buildOrchestratorAgentTools({
    allTools: toolSearchPool,
    config: agent.config,
    context,
    getDeferredCatalog: () => agent.deferredCatalog,
    runWorker: (goal, toolQuery) =>
      runDeferredWorker(agent, goal, toolQuery, context, toolSearchPool),
  });
  agent.deferredCatalog = built.deferred;
  logger.debug(formatCompact({
    tool_search: `${built.orchestratorTools.length}+${built.deferred.length}`,
    stats: built.domainStats,
  }));
  return { tools: built.orchestratorTools, deferredStats: built.domainStats };
}

export async function runDeferredWorker(
  agent: ZhinAgentPrivate,
  goal: string,
  toolQuery: string | undefined,
  context: ToolContext,
  allTools: AgentTool[],
): Promise<string> {
  await notifySubagentGoal(context, goal);
  const allByName = new Map(allTools.map(t => [t.name, t]));
  const workerBase: AgentTool[] = [];
  for (const name of agent.config.toolSearchWorkerBaseTools) {
    const t = allByName.get(name);
    if (t) workerBase.push(t);
  }
  const result = await agent.deferredWorkerRunner.runSync({
    goal,
    toolQuery,
    deferredCatalog: agent.deferredCatalog,
    workerBaseTools: workerBase,
    allToolsByName: allByName,
    origin: context,
    maxToolResults: agent.config.toolSearchMaxResults,
    execPolicyConfig: agent.config,
    execApprovalMode: agent.config.taskExecApprovalMode,
    modelRegistry: agent.modelRegistry,
    provider: agent.provider,
    maxIterations: agent.config.maxSubagentIterations,
    onEvent: (event) => {
      const sessionId = SessionManager.generateId(
        context.platform || '',
        context.senderId || '',
        context.sceneId,
      );
      const payload = agent.emitter.createPayload(sessionId, context, 'text', {
        path: 'agent',
        content: event.goal,
        loadedToolNames: event.loadedToolNames,
        status: event.status,
        iterations: event.iterations,
        error: event.error,
      });
      if (event.phase === 'start') {
        agent.emitter.emit('ai.deferred.start', payload);
      } else {
        agent.emitter.emit('ai.deferred.finish', payload);
      }
    },
  });
  return result.summary;
}
