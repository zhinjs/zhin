import { randomUUID } from 'node:crypto';
import { formatCompact, Logger } from '@zhin.js/logger';
import type { UserMessage } from '@zhin.js/ai';
import type { Message } from '../orchestrator/types.js';
import type { SubagentCompletePayload, SubagentResultSender } from '../subagent/index.js';
import type { DeferredWorkerResult } from '../deferred-worker-runner.js';
import { resolveAgentTurnSessionKey } from '../collaboration/resolve-agent-session-key.js';
import { deliverDeferredAutoContinueReply } from './deferred-delivery.js';
import { buildDeferredAutoContinueUserMessage, shouldDeferredAutoContinue } from './deferred-auto-continue.js';
import { buildSubagentAutoContinueUserMessage } from './subagent-auto-continue.js';
import { persistSubagentResultToContext } from './persist-subagent-context.js';
import { persistDeferredWorkerResultToContext } from './persist-deferred-context.js';
import { processTextTurn } from './turn-pipeline.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { PromptController } from './prompt-controller.js';
import type { ZhinAgentConfig } from '../config/index.js';

const logger = new Logger(null, 'ZhinAgent');

export interface AutoContinueHost {
  config: Required<ZhinAgentConfig>;
  promptController: PromptController;
  getDeferredAutoContinueDepth(sessionKey: string): number;
  setDeferredAutoContinueDepth(sessionKey: string, depth: number): void;
  resetDeferredAutoContinueDepth(sessionKey: string): void;
  getDeferredResultSender(): SubagentResultSender | null;
  runInTurnContext<T>(turnId: string, fn: () => Promise<T>): Promise<T>;
}

type AutoContinueKind = 'deferred' | 'subagent';

async function executeAutoContinueTurn(
  host: AutoContinueHost,
  agent: ZhinAgentPrivate,
  commMessage: Message,
  sessionKey: string,
  taskId: string,
  depth: number,
  kind: AutoContinueKind,
  buildMessage: () => UserMessage,
): Promise<void> {
  await host.promptController.waitForIdle();
  host.setDeferredAutoContinueDepth(sessionKey, depth + 1);

  logger.info(formatCompact({
    [kind]: 'auto_continue',
    task_id: taskId,
    depth: depth + 1,
  }));

  const elements = await host.runInTurnContext(randomUUID(), () =>
    processTextTurn(agent, '', commMessage, [], undefined, {
      prebuiltMessages: [buildMessage()],
      deferredAutoContinue: true,
    }),
  );

  const sender = host.getDeferredResultSender();
  if (sender && elements.length > 0) {
    await deliverDeferredAutoContinueReply(sender, commMessage, elements);
  }

  logger.info(formatCompact({
    [kind]: 'auto_continue_done',
    task_id: taskId,
    depth: depth + 1,
    outbound: elements.length,
  }));
}

export async function continueAfterDeferredWorker(
  host: AutoContinueHost,
  agent: ZhinAgentPrivate,
  commMessage: Message,
  taskId: string,
  goal: string,
  result: DeferredWorkerResult,
): Promise<void> {
  const sessionKey = resolveAgentTurnSessionKey(commMessage);
  const depth = host.getDeferredAutoContinueDepth(sessionKey);

  const persisted = await persistDeferredWorkerResultToContext(agent, commMessage, taskId, goal, result);
  if (!shouldDeferredAutoContinue(host.config, result, depth, persisted)) {
    logger.warn(formatCompact({
      deferred: 'auto_continue_skipped',
      task_id: taskId,
      depth,
      persisted,
      status: result.status,
    }));
    return;
  }

  await executeAutoContinueTurn(
    host,
    agent,
    commMessage,
    sessionKey,
    taskId,
    depth,
    'deferred',
    () => buildDeferredAutoContinueUserMessage(taskId, goal, result.status),
  );
}

export async function continueAfterSubagent(
  host: AutoContinueHost,
  agent: ZhinAgentPrivate,
  payload: SubagentCompletePayload,
): Promise<void> {
  if (host.config.subagentAutoContinue === false) return;

  const commMessage = payload.origin.message;
  const sessionKey = resolveAgentTurnSessionKey(commMessage);
  const depth = host.getDeferredAutoContinueDepth(sessionKey);
  if (depth >= host.config.deferredAutoContinueMaxDepth) {
    logger.warn(formatCompact({
      subagent: 'auto_continue_skipped',
      task_id: payload.taskId,
      reason: 'max_depth',
      depth,
    }));
    return;
  }

  const persisted = await persistSubagentResultToContext(agent, commMessage, payload);
  if (!persisted) {
    logger.warn(formatCompact({
      subagent: 'auto_continue_skipped',
      task_id: payload.taskId,
      reason: 'persist_failed',
    }));
    return;
  }

  await executeAutoContinueTurn(
    host,
    agent,
    commMessage,
    sessionKey,
    payload.taskId,
    depth,
    'subagent',
    () => buildSubagentAutoContinueUserMessage(payload.taskId, payload.label, payload.status),
  );
}
