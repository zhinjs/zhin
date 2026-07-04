/**
 * Register the default kernel executors and the built-in workflow strategies.
 *
 * ADR 0027 makes the OrchestrationKernel the only state-transition authority.
 * For that contract to hold, executors must live in the kernel's registry
 * rather than being passed inline at each call site. This module owns the
 * three executor kinds (local / scene_mention / remote_mesh) and registers
 * generic built-in workflow strategies, so the IM inbound path and tool path can
 * dispatch through `orch.runTask(taskId, message)` without supplying their
 * own executor.
 */
import type { AgentExecutor } from './orchestration-types.js';
import type { OrchestrationKernel } from './orchestration-service.js';
import type { AIServiceRefs } from '../init/shared-refs.js';
import { extractMediaParts } from '../init/message-media.js';
import { buildSubagentInboundTask } from '../media/index.js';
import { sendGroupPeerMention } from '../collaboration/im-mention-delegate.js';
import { executeRemoteOrchestrationTask } from './remote-task-executor.js';
import { createFiveAgentWorkflowStrategy } from '../builtin/five-agent/strategy.js';

export interface RegisterExecutorsDeps {
  refs: AIServiceRefs;
}

/**
 * Register the default executors and built-in workflow strategies on a kernel.
 * Returns a cleanup function that unregisters them.
 *
 * Executors resolve their runtime dependencies lazily through `refs` so they
 * remain valid across the Memory → Database repository upgrade performed by
 * `upgradeOrchestrationRepository`.
 */
export function registerDefaultExecutors(
  kernel: OrchestrationKernel,
  deps: RegisterExecutorsDeps,
): () => void {
  const { refs } = deps;

  const localExecutor: AgentExecutor = {
    kind: 'local',
    async *execute({ task, message }) {
      const zhinAgent = refs.zhinAgent;
      const subagentManager = zhinAgent?.getSubagentManager();
      if (!zhinAgent || !subagentManager) {
        yield { type: 'error', error: 'zhin agent or subagent manager not initialized' };
        return;
      }
      if (!message) {
        yield { type: 'error', error: 'local executor requires an inbound message for subagent origin' };
        return;
      }
      const targetAgentId = task.assignedTo || task.name;
      const aiContent = task.goal || task.description || '';
      const bindingRegistry = refs.aiService?.getBindingRegistry();
      const routeBinding = targetAgentId ? bindingRegistry?.getBinding(targetAgentId) ?? null : null;
      const routeProvider = routeBinding && refs.aiService?.isReady()
        ? refs.aiService!.getProvider(routeBinding.providerAlias)
        : undefined;
      const mediaParts = extractMediaParts(message);
      const inbound = await buildSubagentInboundTask(aiContent, mediaParts, {
        workspaceDir: process.cwd(),
        provider: routeProvider,
      });
      yield { type: 'progress', text: `running local subagent ${targetAgentId}` };
      const result = await subagentManager.spawnSync({
        task: aiContent.trim() || '请处理这条入站消息。',
        runInput: inbound.runInput,
        label: targetAgentId,
        agent: targetAgentId || undefined,
        binding: routeBinding ?? undefined,
        origin: { message },
        notifyContext: message,
        orchestrationTaskId: task.id,
      });
      yield { type: 'result', result };
    },
  };

  const sceneMentionExecutor: AgentExecutor = {
    kind: 'scene_mention',
    async *execute({ task, message }) {
      if (!message) {
        yield { type: 'error', error: 'scene_mention executor requires an inbound message' };
        return;
      }
      const targetEndpointId = task.assignedTo;
      if (!targetEndpointId) {
        yield { type: 'error', error: 'scene_mention task has no assignedTo endpoint' };
        return;
      }
      const delegateText = task.goal || task.description || '请处理上述协作请求。';
      yield { type: 'progress', text: `sending @ delegation to ${targetEndpointId}` };
      const sent = await sendGroupPeerMention({
        message,
        targetEndpointId,
        text: `#${task.id}\n${delegateText}`,
      });
      if (!sent.ok) {
        yield { type: 'error', error: sent.error ?? 'im mention delegation failed' };
        return;
      }
      yield { type: 'progress', text: `waiting_result from ${targetEndpointId}` };
    },
  };

  const remoteMeshExecutor: AgentExecutor = {
    kind: 'remote_mesh',
    async *execute({ task }) {
      yield { type: 'progress', text: `delegating to remote mesh ${task.remoteAgentId ?? task.assignedTo}` };
      const res = await executeRemoteOrchestrationTask(task.id);
      if (!res.ok) {
        yield { type: 'error', error: res.message };
        return;
      }
      yield { type: 'progress', text: res.message };
    },
  };

  const cleanups = [
    kernel.registerExecutor(localExecutor),
    kernel.registerExecutor(sceneMentionExecutor),
    kernel.registerExecutor(remoteMeshExecutor),
    kernel.registerWorkflowStrategy(createFiveAgentWorkflowStrategy()),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
