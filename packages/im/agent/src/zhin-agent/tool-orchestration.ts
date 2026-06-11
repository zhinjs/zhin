import { randomUUID } from 'node:crypto';
import { formatCompact, Logger, truncatePreview } from '@zhin.js/logger';
import type { AgentTool } from '@zhin.js/ai';
import type { Message } from '../orchestrator/types.js';
import { notifySubagentGoal, resolveSubagentDisplayLabel } from '../subagent-goal-notify.js';
import { resolveIMSessionIdFromMessage } from '@zhin.js/ai';
import { buildOrchestratorAgentTools } from './tool-search-orchestrator.js';
import { filterToolsForToolSearchCatalog } from './tool-catalog.js';
import type { ZhinAgentPrivate } from './zhin-agent-private.js';
const logger = new Logger(null, 'ZhinAgent');

export function resolveAgentToolsForTurn(
  agent: ZhinAgentPrivate,
  allTools: AgentTool[],
  commMessage: Message,
): { tools: AgentTool[]; deferredStats?: string } {
  const toolSearchPool = filterToolsForToolSearchCatalog(allTools);
  const built = buildOrchestratorAgentTools({
    allTools: toolSearchPool,
    config: agent.config,
    commMessage,
    subagentManager: agent.subagentManager,
    getDeferredCatalog: () => agent.deferredCatalog,
    runWorker: (goal, toolQuery) =>
      runDeferredWorker(agent, goal, toolQuery, commMessage, toolSearchPool),
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
  commMessage: Message,
  allTools: AgentTool[],
): Promise<string> {
  const taskId = randomUUID().slice(0, 8);
  const label = resolveSubagentDisplayLabel(undefined, goal);
  await notifySubagentGoal(commMessage, {
    taskId,
    kind: 'deferred',
    label,
  });

  const allByName = new Map(allTools.map(t => [t.name, t]));
  const workerBase: AgentTool[] = [];
  for (const name of agent.config.workerBaseTools) {
    const t = allByName.get(name);
    if (t) workerBase.push(t);
  }

  const runOptions = {
    goal,
    toolQuery,
    deferredCatalog: agent.deferredCatalog,
    workerBaseTools: workerBase,
    allToolsByName: allByName,
    origin: commMessage,
    maxToolResults: agent.config.deferredToolMaxResults,
    execPolicyConfig: agent.config,
    execApprovalMode: agent.config.taskExecApprovalMode,
    modelRegistry: agent.modelRegistry,
    provider: agent.provider,
    maxIterations: agent.config.maxSubagentIterations,
    onEvent: (event: {
      phase: 'start' | 'finish';
      goal: string;
      toolQuery?: string;
      loadedToolNames?: string[];
      status?: 'ok' | 'partial' | 'error';
      iterations?: number;
      error?: string;
    }) => {
      const sessionId = resolveIMSessionIdFromMessage(commMessage);
      const payload = agent.emitter.createPayload(sessionId, commMessage, 'text', {
        path: 'agent',
        content: event.goal,
        loadedToolNames: event.loadedToolNames,
        status: event.status,
        iterations: event.iterations,
        error: event.error,
        taskId,
      });
      if (event.phase === 'start') {
        agent.emitter.emit('ai.deferred.start', payload);
      } else {
        agent.emitter.emit('ai.deferred.finish', payload);
      }
    },
  };

  try {
    const result = await agent.deferredWorkerRunner.runSync(runOptions);
    return result.summary;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(formatCompact({
      deferred: 'worker_failed',
      task_id: taskId,
      error: truncatePreview(errorMsg, 200),
    }));
    return JSON.stringify({
      status: 'error',
      task_id: taskId,
      error: errorMsg,
    });
  }
}
