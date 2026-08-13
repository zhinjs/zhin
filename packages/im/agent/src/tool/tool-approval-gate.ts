/**
 * Per-tool approval gate — stacks with ExecPolicy (ADR 0039 P1).
 */
import type { Message, Plugin } from '@zhin.js/core';
import { AgentRunJournal, AgentStreamEventType, type AgentRunEventInput } from '@zhin.js/ai/agent-stream';
import type { ToolApprovalPolicy } from '@zhin.js/ai/tool-policy';
import type { AgentStreamBus, AgentStreamPublishContext } from '../event/agent-stream-bus.js';
import { isApprovalPortAvailable, type ApprovalPort } from '../session/approval-port.js';
import type { ToolApprovalOnceStore } from './tool-approval-once-store.js';

export type ToolApprovalGatePolicy = ToolApprovalPolicy;

export async function resolveToolApprovalRequired(
  policy: ToolApprovalGatePolicy | undefined,
  input: { toolName: string; args: Record<string, unknown>; sessionId: string },
  onceStore?: ToolApprovalOnceStore,
): Promise<boolean> {
  if (!policy || policy === 'never') return false;
  if (policy === 'always' || policy === 'on-risk') return true;
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
  policy?: ToolApprovalGatePolicy;
  plugin?: Plugin;
  bus?: AgentStreamBus;
  port?: ApprovalPort;
  onceStore?: ToolApprovalOnceStore;
  publishCtx?: AgentStreamPublishContext;
  /** Stream-turn journal; request/result become ordered run events when present. */
  journal?: AgentRunJournal;
  signal: AbortSignal;
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

  if (!isApprovalPortAvailable(options.port)) {
    return 'Error: approval required but ApprovalPort unavailable';
  }

  const requestId = `approval_${options.toolName}_${Date.now()}`;
  const publishCtx: AgentStreamPublishContext = {
    sessionId: options.sessionId,
    ...options.publishCtx,
  };

  await publishApprovalEvent(options, {
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
  let approved = false;
  let failure: string | undefined;
  try {
    approved = await options.port.requestApproval({
      requestId,
      toolName: options.toolName,
      question,
      signal: options.signal,
    });
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }

  await publishApprovalEvent(options, {
    type: AgentStreamEventType.INPUT_COMPLETED,
    data: {
      sessionId: options.sessionId,
      requestId,
      toolName: options.toolName,
      kind: 'approval',
      approved,
      ...(failure ? { error: failure } : {}),
    },
  }, publishCtx);

  if (failure) return `Error: approval wait failed — ${failure}`;

  if (!approved) {
    return `Error: tool "${options.toolName}" execution denied by user`;
  }

  if (options.policy === 'once' && options.onceStore) {
    options.onceStore.add(options.sessionId, options.toolName);
  }
  return null;
}

async function publishApprovalEvent(
  options: ToolApprovalGateOptions,
  event: AgentRunEventInput,
  ctx: AgentStreamPublishContext,
): Promise<void> {
  const journalled = options.journal?.append(event);
  if (options.journal && !journalled) return;
  if (options.bus) await options.bus.publish(journalled ?? event, ctx);
}
