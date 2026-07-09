/**
 * 入站 turn 路由 — Kernel 委派 / spawn_task / 本地 ZhinAgent（阶段 4）。
 */
import type { Plugin, Message, AgentTurnMessage } from '@zhin.js/core';
import type { ContentPart, OutputElement } from '@zhin.js/ai';
import { formatCompactLog } from '@zhin.js/logger';
import type { AIServiceRefs } from '../init/shared-refs.js';
import { DEFAULT_ZHIN_AGENT_NAME, type ResolvedAgentBinding } from '../config/types.js';
import { dispatchPeerTask } from './collaboration-dispatch.js';
import { executeInboundSpawnTaskTurn } from './inbound-spawn-task.js';
import { executeInboundAgentTurn } from './inbound-turn-execute.js';
import { collectInboundTurnTools } from './inbound-turn-tools.js';
import type { CollaborationScene, TurnPlan } from './types.js';
import type { ZhinAgent } from '../zhin-agent/index.js';
import type { AIService } from '../service.js';

export type InboundTurnRouteResult =
  | { kind: 'done' }
  | { kind: 'local'; elements: OutputElement[]; cell?: CollaborationScene };

export interface RouteInboundTurnExecutionInput {
  root: Plugin;
  ai: AIService;
  zhinAgent: ZhinAgent;
  commMessage: AgentTurnMessage;
  message: Message;
  aiContent: string;
  turnPlan: TurnPlan;
  cell?: CollaborationScene;
  endpointId: string;
  refs: AIServiceRefs;
  bindingRegistry?: {
    getBinding(name: string): ResolvedAgentBinding | null | undefined;
    requireZhinBinding(): ResolvedAgentBinding;
  };
  mediaParts: ContentPart[];
  onChunk?: (chunk: string, full: string) => void;
  replyAi: (payload: unknown) => Promise<unknown>;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export async function routeInboundTurnExecution(
  input: RouteInboundTurnExecutionInput,
): Promise<InboundTurnRouteResult> {
  const {
    root,
    ai,
    zhinAgent,
    commMessage,
    message,
    aiContent,
    turnPlan,
    cell: initialCell,
    endpointId,
    refs,
    bindingRegistry,
    mediaParts,
    onChunk,
    replyAi,
    logger,
  } = input;

  const cell = initialCell;

  const peerTarget = turnPlan.delegation?.delegateToPeer ?? turnPlan.delegation?.targetEndpointId;
  if (peerTarget && peerTarget !== endpointId && cell) {
    const delegateText = aiContent.trim() || '请处理上述协作请求。';
    try {
      const dispatched = await dispatchPeerTask({
        cell,
        fromEndpointId: endpointId,
        toEndpointId: peerTarget,
        goal: delegateText,
        handlerProfile: turnPlan.handlerProfile,
        message: commMessage,
      });
      if (
        dispatched.task.status === 'completed'
        || dispatched.task.status === 'waiting_result'
        || dispatched.task.status === 'running'
      ) {
        logger.info(formatCompactLog('AI Handler', {
          path: 'kernel_internal_room',
          run: dispatched.runId,
          task: dispatched.taskId,
          from: endpointId,
          to: peerTarget,
          agent: turnPlan.handlerProfile,
        }));
        return { kind: 'done' };
      }
      logger.warn(formatCompactLog('AI Handler', {
        path: 'kernel_internal_room_failed',
        task: dispatched.taskId,
        error: dispatched.task.error,
        fallback: 'local_process',
      }));
    } catch (err) {
      logger.warn(formatCompactLog('AI Handler', {
        path: 'kernel_internal_room_failed',
        error: err instanceof Error ? err.message : String(err),
        fallback: 'local_process',
      }));
    }
  }

  if (
    turnPlan.delegation?.mode === 'spawn_task'
    && turnPlan.delegation.targetAgentId
    && turnPlan.delegation.targetAgentId !== DEFAULT_ZHIN_AGENT_NAME
  ) {
    const spawnResult = await executeInboundSpawnTaskTurn({
      zhinAgent,
      commMessage,
      message,
      aiContent,
      delegation: turnPlan.delegation,
      cell,
      bindingRegistry,
      replyAi,
      logger,
    });
    if (spawnResult.handled) return { kind: 'done' };
  }

  const handlerBinding =
    bindingRegistry?.getBinding(turnPlan.handlerProfile)
    ?? bindingRegistry?.getBinding(DEFAULT_ZHIN_AGENT_NAME)
    ?? bindingRegistry?.requireZhinBinding();

  const externalTools = collectInboundTurnTools({ root, ai, commMessage, cell });
  const localResult = await executeInboundAgentTurn({
    zhinAgent,
    commMessage,
    aiContent,
    externalTools,
    mediaParts,
    handlerBinding: handlerBinding ?? null,
    refs,
    cell,
    endpointId,
    onChunk,
    logger,
  });

  return {
    kind: 'local',
    elements: localResult.elements,
    cell: localResult.cell,
  };
}
