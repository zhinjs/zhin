import type { AgentTool } from '@zhin.js/ai';
import type { AgentRunJournal } from '@zhin.js/ai/agent-stream';
import type { Message, Plugin } from '@zhin.js/core';
import type {
  AgentCoreToolExecutionOutcome,
  ToolExecutionAuthority,
} from '../core/tool-execution-authority.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import { runWithCommMessage } from '../security/comm-message-context.js';
import { readHttpSessionId, resolveSessionInteractionPort } from '../session/resolve-session-interaction-port.js';
import { runWithDeferredTurnController, type DeferredTurnController } from '../tool-catalog/deferred-turn-controller.js';
import { registerBuiltinPolicyExtractors } from './builtin-policy-extractors.js';
import { runToolApprovalGate } from './tool-approval-gate.js';
import { createToolRuntime } from './tool-runtime.js';

export interface ClassicToolExecutionAuthorityOptions {
  readonly host: ZhinAgentPrivate;
  readonly sessionId: string;
  readonly message: Message;
  readonly signal: AbortSignal;
  readonly generation: number;
  readonly rejectApproval: boolean;
  readonly plugin?: Plugin;
  readonly deferredController?: DeferredTurnController;
  readonly journal?: AgentRunJournal;
}

/**
 * Adapter for the remaining classic Tool definitions. AgentCore itself never
 * reads Message, policy configuration, or approval transports through this seam.
 */
export function createClassicToolExecutionAuthority(
  options: ClassicToolExecutionAuthorityOptions,
): ToolExecutionAuthority {
  registerBuiltinPolicyExtractors();
  const runtime = createToolRuntime({
    generation: options.generation,
    signal: options.signal,
    sessionId: options.sessionId,
    commMessage: options.message,
    journal: options.journal
      ? { append: (event) => { options.journal!.append(event); } }
      : undefined,
    config: options.host.config,
    hostPlugin: options.plugin,
  });

  return Object.freeze({
    async execute(
      tool: AgentTool,
      input: Readonly<Record<string, unknown>>,
      toolUseId: string,
    ): Promise<AgentCoreToolExecutionOutcome> {
      const approvalDenied = options.rejectApproval && tool.approval && tool.approval !== 'never'
        ? 'Error: unattended execution rejects tools that require approval'
        : await runToolApprovalGate({
          toolName: tool.name,
          args: { ...input },
          sessionId: options.sessionId,
          commMessage: options.message,
          policy: tool.approval,
          plugin: options.plugin,
          bus: options.host.orchestrator?.agentStreamBus,
          port: resolveSessionInteractionPort(
            options.message,
            options.plugin,
            options.host.httpApprovalAdapter,
            options.host.approvalPort,
          ),
          publishCtx: {
            sessionId: options.sessionId,
            httpSessionId: readHttpSessionId(options.message),
          },
          onceStore: options.host.orchestrator?.approvalOnce,
          journal: options.journal,
          signal: options.signal,
        });
      if (approvalDenied) return Object.freeze({ status: 'denied', reason: approvalDenied });

      try {
        const execute = () => runWithCommMessage(options.message, () =>
          runtime.execute(tool, { ...input }, { toolCallId: toolUseId }));
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
    },
  });
}
