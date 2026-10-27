import type { AgentTool } from '@zhin.js/ai';
import type { AgentRunJournal } from '@zhin.js/ai/agent-stream';
import type { Message } from '@zhin.js/core';
import type {
  AgentCoreToolExecutionOutcome,
  ToolExecutionAuthority,
} from '../core/tool-execution-authority.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import { runWithCommMessage } from '../security/comm-message-context.js';
import { isApprovalPortAvailable } from '../session/approval-port.js';
import { runWithDeferredTurnController, type DeferredTurnController } from '../tool-catalog/deferred-turn-controller.js';
import { resolveBuiltinToolPolicyInput } from './builtin-policy-extractors.js';
import { runToolApprovalGate } from './tool-approval-gate.js';
import { ToolRuntime } from './tool-runtime.js';
import { ToolHardGate } from '../security/tool-hard-gate.js';

export interface ToolExecutionAuthorityOptions {
  readonly host: ZhinAgentPrivate;
  readonly sessionId: string;
  readonly message: Message;
  readonly signal: AbortSignal;
  readonly generation: number;
  readonly rejectApproval: boolean;
  readonly deferredController?: DeferredTurnController;
  readonly journal?: AgentRunJournal;
}

/**
 * Adapter for the Tool definitions. AgentCore itself never
 * reads Message, policy configuration, or approval transports through this seam.
 */
export class RuntimeToolExecutionAuthority implements ToolExecutionAuthority {
  readonly #options: ToolExecutionAuthorityOptions;
  readonly #runtime: ToolRuntime;
  readonly #hardGate: ToolHardGate;

  constructor(options: ToolExecutionAuthorityOptions) {
    this.#options = options;
    const message = options.message;
    const conversation = message.conversation;
    const audit = (options.host as { readonly decisionEvents?: { record?: unknown } }).decisionEvents;
    // ADR 0036 hard gate on the legacy text pipeline too: same settings, same fail-closed rules.
    this.#hardGate = new ToolHardGate(options.host.config.toolHardGate, {
      turnId: `pipeline:${options.sessionId}:${options.generation}:${Date.now().toString(36)}`,
      sessionKey: options.sessionId,
      ...(message.sender?.id ? { requesterId: String(message.sender.id) } : {}),
      ...(conversation?.kind ? { conversationScope: conversation.kind } : {}),
      unattended: options.rejectApproval,
      ...(isApprovalPortAvailable(options.host.approvalPort) ? { approval: options.host.approvalPort } : {}),
      signal: options.signal,
      location: {
        instanceId: String(message.endpointId || conversation?.endpoint?.id || 'unknown'),
        platform: String(message.clientAdapter || conversation?.endpoint?.adapter || 'unknown'),
        sceneId: `${conversation?.kind || 'private'}:${String(conversation?.id ?? options.sessionId)}`,
        userId: message.sender?.id ? String(message.sender.id) : null,
      },
      ...(options.host.toolApprovals ? { queue: options.host.toolApprovals } : {}),
      ...(audit && typeof audit.record === 'function'
        ? { audit: audit as import('../security/tool-hard-gate.js').DecisionAuditSink }
        : {}),
    });
    this.#runtime = new ToolRuntime({
      generation: options.generation,
      signal: options.signal,
      sessionId: options.sessionId,
      commMessage: options.message,
      journal: options.journal
        ? { append: (event) => { options.journal!.append(event); } }
        : undefined,
      config: options.host.config,
      policyInputResolver: resolveBuiltinToolPolicyInput,
    });
  }

  async execute(
    tool: AgentTool,
    input: Readonly<Record<string, unknown>>,
    toolUseId: string,
  ): Promise<AgentCoreToolExecutionOutcome> {
    const options = this.#options;
    const hardGate = await this.#hardGate.check(tool, input, toolUseId);
    if (hardGate.status === 'cancelled') {
      return Object.freeze({ status: 'cancelled', reason: 'Tool execution cancelled' });
    }
    if (hardGate.status === 'denied') return Object.freeze({ status: 'denied', reason: hardGate.reason });
    const approvalDenied = hardGate.status === 'approved'
      ? null
      : options.rejectApproval
      && tool.requiresApproval
      && tool.requiresApproval !== 'never'
      ? 'Error: unattended execution rejects tools that require approval'
      : await runToolApprovalGate({
        toolName: tool.name,
        args: { ...input },
        sessionId: options.sessionId,
        commMessage: options.message,
        policy: tool.requiresApproval,
        bus: options.host.resourceHub?.agentStreamBus,
        port: isApprovalPortAvailable(options.host.approvalPort)
          ? options.host.approvalPort
          : undefined,
        publishCtx: {
          sessionId: options.sessionId,
        },
        onceStore: options.host.resourceHub?.approvalOnce,
        journal: options.journal,
        signal: options.signal,
      });
    if (approvalDenied) return Object.freeze({ status: 'denied', reason: approvalDenied });

    try {
      const execute = () => runWithCommMessage(
        options.message,
        () => this.#runtime.execute(tool, { ...input }, { toolCallId: toolUseId }),
        { ownerApprovals: options.host.ownerApprovals },
      );
      const outcome = options.deferredController
        ? await runWithDeferredTurnController(options.deferredController, execute)
        : await execute();
      if (outcome.denied) {
        return Object.freeze({ status: 'denied', reason: String(outcome.output) });
      }
      return Object.freeze({
        status: 'completed',
        output: outcome.output,
        durationMs: outcome.durationMs,
      });
    } catch (error) {
      if (options.signal.aborted) {
        return Object.freeze({
          status: 'cancelled',
          reason: options.signal.reason instanceof Error
            ? options.signal.reason.message
            : String(options.signal.reason ?? 'Tool execution cancelled'),
        });
      }
      return Object.freeze({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        retryable: false,
      });
    }
  }
}
