/**
 * Register the default kernel executors and the built-in workflow strategies.
 *
 * OrchestrationKernel owns execution: configured local Agents or remote A2A peers.
 */
import type { AgentExecutor } from './orchestration-types.js';
import type { GenerationAdmissionGate } from '@zhin.js/plugin-runtime';
import type { OrchestrationKernel } from './orchestration-service.js';
import type { AIServiceRefs } from '../internal/ai-service-refs.js';
import { readInboundMediaRefs } from '../media/inbound-refs.js';
import { buildSubagentInboundTask } from '../media/index.js';
import { executeRemoteOrchestrationTask, startRemoteTaskRecovery } from './remote-task-executor.js';
import type { RemoteAgentRegistry } from './remote-agent-registry.js';
export interface RegisterExecutorsDeps {
  refs: AIServiceRefs;
  remoteAgents: RemoteAgentRegistry;
  admission: GenerationAdmissionGate;
}

export function registerDefaultExecutors(
  kernel: OrchestrationKernel,
  deps: RegisterExecutorsDeps,
): () => void {
  const { refs } = deps;

  const localExecutor: AgentExecutor = {
    kind: 'local',
    async *execute({ task, message }) {
      const zhinAgent = refs.zhinAgent;
      const subagentSystem = zhinAgent?.getSubagentSystem();
      if (!zhinAgent || !subagentSystem) {
        yield { type: 'error', error: 'zhin agent or subagent manager not initialized' };
        return;
      }
      if (!message) {
        yield { type: 'error', error: 'local executor requires an inbound message for subagent origin' };
        return;
      }
      const targetAgentId = task.assignedTo;
      const aiContent = task.goal || task.description || '';
      const bindingRegistry = refs.aiService?.getBindingRegistry();
      const routeBinding = targetAgentId
        ? bindingRegistry?.getBinding(targetAgentId) ?? undefined
        : undefined;
      if (targetAgentId && !routeBinding) {
        yield { type: 'error', error: `agent binding "${targetAgentId}" is not configured` };
        return;
      }
      const routeProvider = routeBinding && refs.aiService?.isReady()
        ? refs.aiService!.getProvider(routeBinding.providerAlias)
        : undefined;
      const mediaRefs = readInboundMediaRefs(message);
      const inbound = await buildSubagentInboundTask(aiContent, mediaRefs, {
        workspaceDir: process.cwd(),
        provider: routeProvider,
      });
      yield { type: 'progress', text: `running local agent ${routeBinding?.name ?? task.name}` };
      const result = await subagentSystem.spawnSync({
        task: aiContent.trim() || '请处理这条入站消息。',
        runInput: inbound.runInput,
        label: routeBinding?.name ?? task.name,
        agent: routeBinding?.name,
        binding: routeBinding,
        origin: { message },
        notifyContext: message,
        orchestrationTaskId: task.id,
      });
      yield { type: 'result', result };
    },
  };

  const remoteMeshExecutor: AgentExecutor = {
    kind: 'remote_mesh',
    async *execute({ task }) {
      yield { type: 'progress', text: `delegating to remote mesh ${task.remoteAgentId ?? task.assignedTo}` };
      const res = await executeRemoteOrchestrationTask(kernel, deps.remoteAgents, task.id);
      if (!res.ok) {
        if ('cancelled' in res && res.cancelled) return;
        yield { type: 'error', error: res.message };
        return;
      }
      yield { type: 'progress', text: res.message };
    },
  };

  const cleanups = [
    kernel.registerExecutor(localExecutor),
    kernel.registerExecutor(remoteMeshExecutor),
    startRemoteTaskRecovery(kernel, deps.remoteAgents, deps.admission),
    // five-agent WorkflowStrategy is opt-in: kernel.registerWorkflowStrategy(createFiveAgentWorkflowStrategy())
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
