import { formatCompact, getLogger } from '@zhin.js/logger';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import type { AgentTool, ModelRegistry, AIProvider } from '@zhin.js/ai';
import { getAgentDispatcher } from '../orchestrator/agent-dispatcher.js';
import { getActiveTurnTracker } from '../internal/turn-context.js';
import type { ZhinAgentEventEmitter } from '../event/event-emitter.js';
import type { ZhinAgentConfig } from '../config/index.js';
import { SubagentSystem } from './subagent-system.js';
import type { SubagentCompletePayload } from './subagent-runtime.js';
const logger = getLogger('ZhinAgent');

export interface SubagentSystemInitOptions {
  provider: AIProvider;
  config: Required<ZhinAgentConfig>;
  modelRegistry: ModelRegistry | null;
  emitter: ZhinAgentEventEmitter;
  createTools: () => AgentTool[];
  onSubagentComplete: (payload: SubagentCompletePayload) => Promise<void>;
}

export function createSubagentSystem(opts: SubagentSystemInitOptions): SubagentSystem {
  const system = new SubagentSystem();
  system.attachRuntime({
    provider: opts.provider,
    workspace: process.cwd(),
    createTools: opts.createTools,
    subagentTools: opts.config.subagentTools,
    maxIterations: opts.config.maxSubagentIterations,
    maxParallelSubagents: opts.config.maxParallelSubagents,
    execPolicyConfig: opts.config,
    modelRegistry: opts.modelRegistry,
    agentDispatcher: getAgentDispatcher(),
    onSubagentUsage: (usage) => getActiveTurnTracker()?.addSubagentUsage(usage),
    registerSubagentTask: (done) => getActiveTurnTracker()?.trackSubagent(done),
    eventEmitter: opts.emitter,
    onEvent: (event) => {
      const sessionId = resolveIMSessionIdFromMessage(event.origin.message);
      const payload = opts.emitter.createPayload(sessionId, event.origin.message, 'text', {
        source: 'subagent',
        path: 'agent',
        taskId: event.taskId,
        label: event.label,
        content: event.task,
        status: event.status,
        error: event.error,
        reply: event.result,
        agentId: event.agent,
        hookContext: {
          subagentAgent: event.agent,
        },
      });
      if (event.phase === 'spawn') {
        opts.emitter.emit('ai.subagent.spawn', payload);
      } else if (event.phase === 'start') {
        opts.emitter.emit('ai.subagent.start', payload);
      } else {
        opts.emitter.emit('ai.subagent.finish', payload);
      }
    },
    onSubagentComplete: opts.onSubagentComplete,
  });
  logger.debug(formatCompact({ subagent_system: 'initialized' }));
  return system;
}
