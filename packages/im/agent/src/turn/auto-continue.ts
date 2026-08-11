import { randomUUID } from 'node:crypto';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { UserMessage } from '@zhin.js/ai';
import type { Message } from '../orchestrator/types.js';
import type { SubagentCompletePayload } from '../subagent/index.js';
import type { DeferredWorkerResult } from '../deferred-worker-runner.js';
import { resolveAgentTurnSessionKey } from '../collaboration/resolve-agent-session-key.js';
import { deliverDeferredAutoContinueReply } from './deferred-delivery.js';
import { buildDeferredAutoContinueUserMessage, shouldDeferredAutoContinue } from './deferred-auto-continue.js';
import {
  buildSubagentAutoContinueUserMessage,
  buildSubagentAutoContinueRetryMessage,
} from './subagent-auto-continue.js';
import { persistSubagentResultToContext } from './persist-subagent-context.js';
import { persistDeferredWorkerResultToContext } from './persist-deferred-context.js';
import { processTextTurn } from './turn-pipeline.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';

const logger = getLogger('ZhinAgent');

/** auto-continue 实际读取的窄面（单参数收敛后的内部 seam）。 */
export type AutoContinueHost = Pick<
  ZhinAgentPrivate,
  'config' | 'promptController' | 'deferred' | 'runInTurnContext'
>;

type AutoContinueKind = 'deferred' | 'subagent';

async function runAutoContinueProcess(
  agent: ZhinAgentPrivate,
  commMessage: Message,
  buildMessage: () => UserMessage,
) {
  return agent.runInTurnContext(randomUUID(), () =>
    processTextTurn(agent, '', commMessage, [], undefined, {
      prebuiltMessages: [buildMessage()],
      deferredAutoContinue: true,
    }),
  );
}

async function executeAutoContinueTurn(
  agent: ZhinAgentPrivate,
  commMessage: Message,
  sessionKey: string,
  taskId: string,
  depth: number,
  kind: AutoContinueKind,
  buildMessage: () => UserMessage,
  /** 仅 subagent：首轮空回复时再催一次主 Agent 汇总（仍不直接转发子 Agent 原文） */
  buildRetryMessage?: () => UserMessage,
): Promise<void> {
  const host: AutoContinueHost = agent;
  await host.promptController.waitForIdle();
  host.deferred.setAutoContinueDepth(sessionKey, depth + 1);

  logger.info(formatCompact({ op: `${kind}_auto_continue`, task: taskId, depth: depth + 1 }));

  let elements = await runAutoContinueProcess(agent, commMessage, buildMessage);

  if (elements.length === 0 && buildRetryMessage) {
    logger.warn(formatCompact({
      op: `${kind}_auto_continue_retry`,
      task: taskId,
      reason: 'empty_outbound',
    }));
    elements = await runAutoContinueProcess(agent, commMessage, buildRetryMessage);
  }

  const sender = host.deferred.resultSender;
  if (sender && elements.length > 0) {
    await deliverDeferredAutoContinueReply(sender, commMessage, elements);
  } else if (elements.length === 0) {
    logger.warn(formatCompact({
      op: `${kind}_auto_continue_empty`,
      task: taskId,
      reason: 'main_agent_no_user_reply',
    }));
  }

  logger.info(formatCompact({ op: `${kind}_auto_continue_done`, task: taskId, outbound: elements.length }));
}

export async function continueAfterDeferredWorker(
  agent: ZhinAgentPrivate,
  commMessage: Message,
  taskId: string,
  goal: string,
  result: DeferredWorkerResult,
): Promise<void> {
  const host: AutoContinueHost = agent;
  const sessionKey = resolveAgentTurnSessionKey(commMessage);
  const depth = host.deferred.getAutoContinueDepth(sessionKey);

  const persisted = await persistDeferredWorkerResultToContext(agent, commMessage, taskId, goal, result);
  if (!shouldDeferredAutoContinue(host.config, result, depth, persisted)) {
    logger.warn(formatCompact({
      op: 'deferred_auto_continue_skip',
      task: taskId,
      depth,
      status: result.status,
    }));
    return;
  }

  await executeAutoContinueTurn(
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
  agent: ZhinAgentPrivate,
  payload: SubagentCompletePayload,
): Promise<void> {
  const host: AutoContinueHost = agent;
  if (host.config.subagentAutoContinue === false) return;

  const commMessage = payload.origin.message;
  const sessionKey = resolveAgentTurnSessionKey(commMessage);
  const depth = host.deferred.getAutoContinueDepth(sessionKey);
  if (depth >= host.config.deferredAutoContinueMaxDepth) {
    logger.warn(formatCompact({
      op: 'subagent_auto_continue_skip',
      task: payload.taskId,
      reason: 'max_depth',
    }));
    return;
  }

  const persisted = await persistSubagentResultToContext(agent, commMessage, payload);
  if (!persisted) {
    logger.warn(formatCompact({
      op: 'subagent_auto_continue_skip',
      task: payload.taskId,
      reason: 'persist_failed',
    }));
    return;
  }

  await executeAutoContinueTurn(
    agent,
    commMessage,
    sessionKey,
    payload.taskId,
    depth,
    'subagent',
    () => buildSubagentAutoContinueUserMessage(payload.taskId, payload.label, payload.status),
    () => buildSubagentAutoContinueRetryMessage(payload.taskId, payload.label, payload.status),
  );
}
