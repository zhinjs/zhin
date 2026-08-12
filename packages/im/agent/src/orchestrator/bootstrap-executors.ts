/**
 * Register the default kernel executors and the built-in workflow strategies.
 *
 * ADR 0027 / 0036 — OrchestrationKernel owns executors:
 * local / internal_room / im_projection / remote_mesh
 */
import type { AgentExecutor } from './orchestration-types.js';
import type { OrchestrationKernel } from './orchestration-service.js';
import type { AIServiceRefs } from '../internal/ai-service-refs.js';
import { readInboundMediaRefs } from '../media/inbound-refs.js';
import { buildSubagentInboundTask } from '../media/index.js';
import type { AgentRunInput } from '../media/media-types.js';
import { sendGroupPeerMention } from '../collaboration/im-mention-delegate.js';
import { getCollaborationSceneService } from '../collaboration/scene-service.js';
import { assertPeerMember, projectInternalRoomTaskToIm } from '../collaboration/collaboration-dispatch.js';
import { findCellMemberByEndpoint } from '../collaboration/collaboration-config.js';
import { isPipelineRole, type CollaborationScene } from '../collaboration/types.js';
import { resolvePipelineRoleBinding } from '../config/resolve-pipeline-binding.js';
import { executeRemoteOrchestrationTask } from './remote-task-executor.js';
import type { AIService } from '../service.js';
import type { ResolvedAgentBinding } from '../config/types.js';
export interface RegisterExecutorsDeps {
  refs: AIServiceRefs;
}

export function resolveInternalRoomBinding(
  aiService: AIService,
  cell: CollaborationScene,
  endpointKey: string,
): ResolvedAgentBinding {
  const member = findCellMemberByEndpoint(cell, endpointKey);
  if (!member) {
    throw new Error(`endpoint "${endpointKey}" is not a member of collaboration scene "${cell.id}"`);
  }
  if (isPipelineRole(member.pipelineRole)) {
    return resolvePipelineRoleBinding(member.pipelineRole, aiService.getRoutingConfig());
  }
  const binding = aiService.getBindingRegistry().getBinding(member.primary);
  if (!binding) {
    throw new Error(`agent binding "${member.primary}" is not configured for endpoint ${endpointKey}`);
  }
  return binding;
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
      const targetAgentId = task.assignedTo || task.name;
      const aiContent = task.goal || task.description || '';
      const bindingRegistry = refs.aiService?.getBindingRegistry();
      const routeBinding = targetAgentId ? bindingRegistry?.getBinding(targetAgentId) ?? null : null;
      const routeProvider = routeBinding && refs.aiService?.isReady()
        ? refs.aiService!.getProvider(routeBinding.providerAlias)
        : undefined;
      const mediaRefs = readInboundMediaRefs(message);
      const inbound = await buildSubagentInboundTask(aiContent, mediaRefs, {
        workspaceDir: process.cwd(),
        provider: routeProvider,
      });
      yield { type: 'progress', text: `running local subagent ${targetAgentId}` };
      const result = await subagentSystem.spawnSync({
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
      const targetEndpointKey = task.assignedTo;
      if (!targetEndpointKey) {
        yield { type: 'error', error: 'internal_room task has no assignedTo endpoint' };
        return;
      }

      const sceneId = typeof task.context?.collaborationSceneId === 'string'
        ? task.context.collaborationSceneId
        : undefined;
      if (!sceneId) {
        yield { type: 'error', error: 'internal_room task requires collaborationSceneId' };
        return;
      }
      const cell = getCollaborationSceneService().getScene(sceneId);
      if (!cell) {
        yield { type: 'error', error: `collaboration scene "${sceneId}" not found` };
        return;
      }
      try {
        assertPeerMember(cell, targetEndpointKey);
      } catch (err) {
        yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
        return;
      }

      const runtime = refs.zhinAgent;
      const subagentSystem = runtime?.getSubagentSystem();
      if (!runtime || !subagentSystem) {
        yield { type: 'error', error: 'zhin agent or subagent manager not initialized' };
        return;
      }
      if (!message) {
        yield { type: 'error', error: 'internal_room executor requires an inbound message for peer subagent origin' };
        return;
      }

      const delegateText = task.goal || task.description || '请处理上述协作请求。';
      yield { type: 'progress', text: `internal_room dispatch to ${targetEndpointKey}` };

      if (task.context?.projectToIm === true && message && targetEndpointKey) {
        await projectInternalRoomTaskToIm({
          runId: run.id,
          taskId: task.id,
          message,
          toEndpointKey: targetEndpointKey,
          goal: delegateText,
        });
      }

      const aiService = refs.aiService;
      if (!aiService) {
        yield { type: 'error', error: 'AI service is not initialized' };
        return;
      }
      let routeBinding: ResolvedAgentBinding;
      try {
        routeBinding = resolveInternalRoomBinding(aiService, cell, targetEndpointKey);
      } catch (error) {
        yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
        return;
      }
      const routeProvider = aiService.isReady()
        ? aiService.getProvider(routeBinding.providerAlias)
        : undefined;

      let runInput: AgentRunInput | undefined = delegateText;
      const mediaRefs = readInboundMediaRefs(message);
      const inbound = await buildSubagentInboundTask(delegateText, mediaRefs, {
        workspaceDir: process.cwd(),
        provider: routeProvider,
      });
      runInput = inbound.runInput;

      const result = await subagentSystem.spawnSync({
        task: delegateText.trim() || '请处理上述协作请求。',
        runInput,
        label: targetEndpointKey,
        agent: routeBinding.name,
        binding: routeBinding,
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
      const targetEndpointKey = task.assignedTo;
      if (!targetEndpointKey) {
        yield { type: 'error', error: 'im_projection task has no assignedTo endpoint' };
        return;
      }
      const delegateText = task.goal || task.description || '请处理上述协作请求。';
      yield { type: 'progress', text: `projecting IM @ to ${targetEndpointKey}` };
      const sent = await sendGroupPeerMention({
        message,
        targetEndpointKey,
        text: delegateText.includes(`#${task.id}`) ? delegateText : `#${task.id}\n${delegateText}`,
      });
      if (!sent.ok) {
        yield { type: 'error', error: sent.error ?? 'im projection failed' };
        return;
      }
      yield { type: 'progress', text: `waiting_result from ${targetEndpointKey}` };
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
    // five-agent WorkflowStrategy is opt-in: kernel.registerWorkflowStrategy(createFiveAgentWorkflowStrategy())
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
