import { runTurnToolPolicies } from '../security/policy-facade.js';
import type { ToolCapability } from '../plugin-runtime/capability-ingress.js';
import { toolInvocationFromTurn } from '../plugin-runtime/capability-tools.js';
import type { TurnIngress } from '../turn/turn-ingress.js';
import { isApprovalPortAvailable } from '../session/approval-port.js';
import type { AgentTool } from '@zhin.js/ai';
import type { ToolExecutionAuthority } from '../core/tool-execution-authority.js';
import { TurnJournalCommitError } from '../turn/journal-integrity.js';
import { NetworkAccessDeniedError } from '../security/network-policy.js';

export type TurnToolOutcome =
  | Readonly<{ status: 'completed'; output: unknown; durationMs: number }>
  | Readonly<{ status: 'denied'; policy: string; reason: string }>
  | Readonly<{ status: 'cancelled'; reason: string }>
  | Readonly<{ status: 'failed'; error: string; retryable: boolean }>;

/** Sole execution authority for Tool capabilities within one fixed Turn lease. */
export class TurnToolRuntime {
  readonly #tools: ReadonlyMap<string, ToolCapability>;

  constructor(
    private readonly turn: TurnIngress,
    tools: readonly ToolCapability[],
  ) {
    this.#tools = new Map(tools.map((tool) => [tool.name, tool]));
  }

  async execute(
    name: string,
    input: Readonly<Record<string, unknown>>,
    toolUseId: string,
  ): Promise<TurnToolOutcome> {
    const tool = this.#tools.get(name);
    if (!tool) return this.#deny(name, toolUseId, 'capability', `Unknown Tool capability: ${name}`);
    await this.#append({ type: 'tool_call', toolName: name, args: { ...input }, toolUseId });
    if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, 0);
    const decision = await runTurnToolPolicies({ turn: this.turn, tool, input });
    if (decision.status === 'denied') {
      return this.#deny(name, toolUseId, decision.policy, decision.reason);
    }
    if (decision.status === 'approval_required') {
      if (this.turn.policy.unattended || !isApprovalPortAvailable(this.turn.ports.approval)) {
        return this.#deny(name, toolUseId, decision.policy, 'approval required but ApprovalPort unavailable');
      }
      const approved = await this.turn.ports.approval.requestApproval({
        requestId: `${this.turn.identity.turnId}:${toolUseId}`,
        toolName: name,
        question: `工具「${name}」需要确认后执行。是否继续？`,
        signal: this.turn.signal,
      });
      if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, 0);
      if (!approved) return this.#deny(name, toolUseId, decision.policy, 'tool execution denied by user');
    }

    const startedAt = Date.now();
    try {
      const output = await tool.execute(decision.input, toolInvocationFromTurn(this.turn));
      const durationMs = Date.now() - startedAt;
      if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, durationMs);
      await this.#append({ type: 'tool_result', toolName: name, output, durationMs, toolUseId });
      return Object.freeze({ status: 'completed', output, durationMs });
    } catch (error) {
      if (error instanceof TurnJournalCommitError) throw error;
      const durationMs = Date.now() - startedAt;
      if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, durationMs);
      if (error instanceof NetworkAccessDeniedError) {
        return this.#deny(name, toolUseId, error.policy, error.message);
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.#append({ type: 'tool_failed', toolName: name, toolUseId, error: message, durationMs });
      return Object.freeze({ status: 'failed', error: message, retryable: false });
    }
  }

  async #deny(toolName: string, toolUseId: string, policy: string, reason: string): Promise<TurnToolOutcome> {
    await this.#append({ type: 'tool_denied', toolName, toolUseId, policy, reason });
    return Object.freeze({ status: 'denied', policy, reason });
  }

  async #cancel(toolName: string, toolUseId: string, durationMs: number): Promise<TurnToolOutcome> {
    const reason = this.turn.signal.reason instanceof Error
      ? this.turn.signal.reason.message
      : String(this.turn.signal.reason ?? 'turn cancelled');
    await this.#append({ type: 'tool_cancelled', toolName, toolUseId, reason, durationMs });
    return Object.freeze({ status: 'cancelled', reason });
  }

  async #append(event: import('../event/turn-event.js').TurnEvent): Promise<void> {
    try {
      await this.turn.ports.journal.append(event);
    } catch (error) {
      throw new TurnJournalCommitError(error);
    }
  }
}

/** Adapts canonical capability execution to the full AgentCore seam. */
export function turnToolExecutionAuthority(runtime: TurnToolRuntime): ToolExecutionAuthority {
  return Object.freeze({
    execute: (tool: AgentTool, input: Readonly<Record<string, unknown>>, toolUseId: string) =>
      runtime.execute(tool.name, input, toolUseId),
  });
}
