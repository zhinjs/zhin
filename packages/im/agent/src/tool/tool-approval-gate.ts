/**
 * Per-tool approval gate — stacks with ExecPolicy (ADR 0039 P1).
 */
import type { Message, Plugin } from '@zhin.js/core';
import { AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import type { ToolApprovalPolicy } from '@zhin.js/ai/tool-policy';
import type { AgentStreamBus, AgentStreamPublishContext } from '../event/agent-stream-bus.js';
import type { SessionInteractionPort } from '../session/session-interaction-port.js';
import type { ToolApprovalOnceStore } from './tool-approval-once-store.js';

export async function resolveToolApprovalRequired(
  policy: ToolApprovalPolicy | undefined,
  input: { toolName: string; args: Record<string, unknown>; sessionId: string },
  onceStore?: ToolApprovalOnceStore,
): Promise<boolean> {
  if (!policy || policy === 'never') return false;
  if (policy === 'always') return true;
  if (policy === 'once') {
    if (!onceStore) return true;
    return !onceStore.has(input.sessionId, input.toolName);
  }
  return Boolean(await policy({ toolName: input.toolName, args: input.args }));
}

export interface ToolApprovalGateOptions {
  toolName: string;
  args: Record<string, unknown>;
  sessionId: string;
  commMessage: Message;
  policy?: ToolApprovalPolicy;
  plugin?: Plugin;
  bus?: AgentStreamBus;
  port?: SessionInteractionPort;
  onceStore?: ToolApprovalOnceStore;
  publishCtx?: AgentStreamPublishContext;
}

/**
 * Returns denial message when approval is required but not granted; otherwise null.
 */
export async function runToolApprovalGate(
  options: ToolApprovalGateOptions,
): Promise<string | null> {
  const required = await resolveToolApprovalRequired(options.policy, {
    toolName: options.toolName,
    args: options.args,
    sessionId: options.sessionId,
  }, options.onceStore);
  if (!required) return null;

  if (!options.bus || !options.port) {
    return 'Error: approval required but AgentStreamBus / SessionInteractionPort unavailable';
  }

  const requestId = `approval_${options.toolName}_${Date.now()}`;
  const publishCtx: AgentStreamPublishContext = {
    sessionId: options.sessionId,
    ...options.publishCtx,
  };

  await options.bus.publish({
    type: AgentStreamEventType.INPUT_REQUESTED,
    data: {
      sessionId: options.sessionId,
      requestId,
      toolName: options.toolName,
      kind: 'approval',
      args: options.args,
    },
  }, publishCtx);

  const question = `工具「${options.toolName}」需要确认后执行。是否继续？`;
  let approved: boolean;
  try {
    approved = await options.port.requestApproval({
      requestId,
      toolName: options.toolName,
      question,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: approval wait failed — ${msg}`;
  }

  await options.bus.publish({
    type: AgentStreamEventType.INPUT_COMPLETED,
    data: {
      sessionId: options.sessionId,
      requestId,
      toolName: options.toolName,
      kind: 'approval',
      approved,
    },
  }, publishCtx);

  if (!approved) {
    return `Error: tool "${options.toolName}" execution denied by user`;
  }

  if (options.policy === 'once' && options.onceStore) {
    options.onceStore.add(options.sessionId, options.toolName);
  }
  return null;
}
