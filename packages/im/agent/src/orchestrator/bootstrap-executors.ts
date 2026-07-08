/**
 * Register the default kernel executors and the built-in workflow strategies.
 *
 * ADR 0027 / 0036 — OrchestrationKernel owns executors:
 * local / internal_room / im_projection / remote_mesh
 */
import type { AgentExecutor } from './orchestration-types.js';
import type { OrchestrationKernel } from './orchestration-service.js';
import type { AIServiceRefs } from '../init/shared-refs.js';
import { extractMediaParts } from '../init/message-media.js';
import { buildSubagentInboundTask } from '../media/index.js';
import { sendGroupPeerMention } from '../collaboration/im-mention-delegate.js';
import { getAgentRuntimeRegistry } from '../collaboration/runtime-registry.js';
import { getCollaborationSceneService } from '../collaboration/scene-service.js';
import { assertPeerMember, projectInternalRoomTaskToIm } from '../collaboration/collaboration-dispatch.js';
import { executeRemoteOrchestrationTask } from './remote-task-executor.js';
import { createFiveAgentWorkflowStrategy } from '../builtin/five-agent/strategy.js';

export interface RegisterExecutorsDeps {
  refs: AIServiceRefs;
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

  const internalRoomExecutor: AgentExecutor = {
    kind: 'internal_room',
    async *execute({ task, message, run }) {
      const targetEndpointId = task.assignedTo;
      if (!targetEndpointId) {
        yield { type: 'error', error: 'internal_room task has no assignedTo endpoint' };
        return;
      }

      const sceneId = typeof task.context?.collaborationSceneId === 'string'
        ? task.context.collaborationSceneId
        : undefined;
      if (sceneId) {
        const cell = getCollaborationSceneService().getScene(sceneId);
        if (!cell) {
          yield { type: 'error', error: `collaboration scene "${sceneId}" not found` };
          return;
        }
        try {
          assertPeerMember(cell, targetEndpointId);
        } catch (err) {
          yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
          return;
        }
      }

      const peerAgent = getAgentRuntimeRegistry().getForEndpoint(targetEndpointId);
      const subagentManager = peerAgent?.getSubagentManager();
      if (!peerAgent || !subagentManager) {
        yield { type: 'error', error: `no ZhinAgent runtime for endpoint ${targetEndpointId}` };
        return;
      }
      if (!message) {
        yield { type: 'error', error: 'internal_room executor requires an inbound message for peer subagent origin' };
        return;
      }

      const delegateText = task.goal || task.description || '请处理上述协作请求。';
      yield { type: 'progress', text: `internal_room dispatch to ${targetEndpointId}` };

      if (task.context?.projectToIm === true && message && targetEndpointId) {
        await projectInternalRoomTaskToIm({
          runId: run.id,
          taskId: task.id,
          message,
          toEndpointId: targetEndpointId,
          goal: delegateText,
        });
      }

      const bindingRegistry = refs.aiService?.getBindingRegistry();
      const routeBinding = bindingRegistry?.getBinding(targetEndpointId) ?? null;
      const routeProvider = routeBinding && refs.aiService?.isReady()
        ? refs.aiService!.getProvider(routeBinding.providerAlias)
        : undefined;

      let runInput: string | import('@zhin.js/ai').ContentPart[] | undefined = delegateText;
      const mediaParts = extractMediaParts(message);
      const inbound = await buildSubagentInboundTask(delegateText, mediaParts, {
        workspaceDir: process.cwd(),
        provider: routeProvider,
      });
      runInput = inbound.runInput;

      const result = await subagentManager.spawnSync({
        task: delegateText.trim() || '请处理上述协作请求。',
        runInput,
        label: targetEndpointId,
        agent: targetEndpointId,
        binding: routeBinding ?? undefined,
        origin: { message },
        notifyContext: message,
        orchestrationTaskId: task.id,
      });
      yield { type: 'result', result };
    },
  };

  const imProjectionExecutor: AgentExecutor = {
    kind: 'im_projection',
    async *execute({ task, message }) {
      if (!message) {
        yield { type: 'error', error: 'im_projection executor requires an inbound message' };
        return;
      }
      const targetEndpointId = task.assignedTo;
      if (!targetEndpointId) {
        yield { type: 'error', error: 'im_projection task has no assignedTo endpoint' };
        return;
      }
      const delegateText = task.goal || task.description || '请处理上述协作请求。';
      yield { type: 'progress', text: `projecting IM @ to ${targetEndpointId}` };
      const sent = await sendGroupPeerMention({
        message,
        targetEndpointId,
        text: delegateText.includes(`#${task.id}`) ? delegateText : `#${task.id}\n${delegateText}`,
      });
      if (!sent.ok) {
        yield { type: 'error', error: sent.error ?? 'im projection failed' };
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
    kernel.registerExecutor(internalRoomExecutor),
    kernel.registerExecutor(imProjectionExecutor),
    kernel.registerExecutor(remoteMeshExecutor),
    kernel.registerWorkflowStrategy(createFiveAgentWorkflowStrategy()),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
