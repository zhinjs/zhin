/**
 * Per-tool approval gate — stacks with ExecPolicy (ADR 0039 P1).
 */
import type { Message } from '@zhin.js/core';
import { AgentRunJournal, AgentStreamEventType, type AgentRunEventInput } from '@zhin.js/ai/agent-stream';
import type { ToolApprovalPolicy } from '@zhin.js/ai/tool-policy';
import type { AgentStreamBus, AgentStreamPublishContext } from '../event/agent-stream-bus.js';
import { isApprovalPortAvailable, type ApprovalPort } from '../session/approval-port.js';
import type { ToolApprovalOnceStore } from './tool-approval-once-store.js';
import { markdownLiteral, markdownLiteralLines } from './approval-presentation.js';
import { redactApprovalDisplay, redactSecretText } from '../decision-events.js';

export type ToolApprovalGatePolicy = ToolApprovalPolicy;

export async function resolveToolApprovalRequired(
  policy: ToolApprovalGatePolicy | undefined,
  input: { toolName: string; args: Record<string, unknown>; sessionId: string },
  onceStore?: ToolApprovalOnceStore,
): Promise<boolean> {
  if (!policy || policy === 'never') return false;
  if (policy === 'always' || policy === 'on-risk' || policy === 'human') return true;
  if (policy === 'once') {
    if (!onceStore) return true;
    return !onceStore.has(input.sessionId, input.toolName);
  }
  return Boolean(await policy({ toolName: input.toolName, args: input.args }));
}

/**
 * The legacy gate's card (#1250 b113). It is Markdown (Slack mrkdwn / Telegram HTML after the adapter
 * converts it): the tool name (an MCP server names its own tools) and every model-chosen value are shown
 * literally, one inline code span each, with secrets masked. The lines follow the main approval card
 * (`formatApprovalQuestion` in `turn-tool-runtime.ts`): the command, working directory and target file
 * when the arguments have them, and the masked arguments under `human` or whenever neither a command nor a
 * path says what the call does, so no policy asks for a blind approval. The scope key keeps the raw values.
 */
function formatLegacyApprovalQuestion(toolName: string, args: Readonly<Record<string, unknown>>, humanOnly: boolean): string {
  const command = typeof args.command === 'string' ? redactSecretText(args.command.trim()) : '';
  const cwd = typeof args.cwd === 'string' ? args.cwd.trim() : '';
  const path = ['file_path', 'path'].map(key => args[key]).find(value => typeof value === 'string') as string | undefined;
  return [
    `工具「${markdownLiteral(toolName)}」需要确认后执行。是否继续？`,
    command ? `命令：${markdownLiteralLines(command)}` : undefined,
    cwd ? `工作目录：${markdownLiteral(cwd)}` : undefined,
    path ? `目标文件：${markdownLiteral(path)}` : undefined,
    humanOnly || (!command && !path && Object.keys(args).length > 0)
      ? `本次参数：${markdownLiteral(stableApprovalValue(redactApprovalDisplay(args)))}`
      : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export interface ToolApprovalGateOptions {
  toolName: string;
  args: Record<string, unknown>;
  sessionId: string;
  commMessage: Message;
  policy?: ToolApprovalGatePolicy;
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
      sessionKey: options.sessionId,
      requesterId: options.commMessage.sender?.id,
      toolName: options.toolName,
      kind: 'approval',
      args: options.args,
    },
  }, publishCtx);

  const question = formatLegacyApprovalQuestion(options.toolName, options.args, options.policy === 'human');
  let approved = false;
  let failure: string | undefined;
  try {
    approved = await options.port.requestApproval({
      ...(options.policy === 'human' ? { humanOnly: true } : {}),
      requestId,
      sessionKey: options.sessionId,
      conversationScope: options.commMessage.conversation.kind,
      requesterId: options.commMessage.sender?.id,
      toolName: options.toolName,
      scopeKey: `${options.toolName}:${stableApprovalValue(options.args)}`,
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

function stableApprovalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableApprovalValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableApprovalValue(entry)}`)
      .join(',')}}`;
  }
  if (typeof value === 'undefined') return 'undefined';
  try { return JSON.stringify(value); } catch { return String(value); }
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
