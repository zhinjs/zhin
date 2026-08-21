import { runTurnToolPolicies } from '../security/policy-facade.js';
import type { ToolCapability } from '../plugin-runtime/capability-ingress.js';
import { toolInvocationFromTurn } from '../plugin-runtime/capability-tools.js';
import type { TurnIngress } from '../turn/turn-ingress.js';
import { isApprovalPortAvailable } from '../session/approval-port.js';
import type { AgentTool, ToolExecutionCause } from '@zhin.js/ai';
import type { ToolExecutionAuthority } from '../core/tool-execution-authority.js';
import { TurnJournalCommitError } from '../turn/journal-integrity.js';
import { NetworkAccessDeniedError } from '../security/network-policy.js';

type ToolJournalEvent = Extract<import('../event/turn-event.js').TurnEvent, {
  type: 'tool_call' | 'tool_result' | 'tool_denied' | 'tool_failed' | 'tool_cancelled';
}>;

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
    cause?: ToolExecutionCause,
  ): Promise<TurnToolOutcome> {
    const tool = this.#tools.get(name);
    const causedBy = freezeToolExecutionCause(cause);
    if (!tool) return this.#deny(name, toolUseId, 'capability', `Unknown Tool capability: ${name}`, causedBy);
    await this.#append({ type: 'tool_call', toolName: name, args: { ...input }, toolUseId }, causedBy);
    if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, 0, causedBy);
    const decision = await runTurnToolPolicies({ turn: this.turn, tool, input });
    if (decision.status === 'denied') {
      return this.#deny(name, toolUseId, decision.policy, decision.reason, causedBy);
    }
    if (decision.status === 'approval_required') {
      if (this.turn.policy.unattended || !isApprovalPortAvailable(this.turn.ports.approval)) {
        return this.#deny(name, toolUseId, decision.policy, 'approval required but ApprovalPort unavailable', causedBy);
      }
      const approved = await this.turn.ports.approval.requestApproval({
        requestId: `${this.turn.identity.turnId}:${toolUseId}`,
        toolName: name,
        question: `工具「${name}」需要确认后执行。是否继续？`,
        signal: this.turn.signal,
      });
      if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, 0, causedBy);
      if (!approved) return this.#deny(name, toolUseId, decision.policy, 'tool execution denied by user', causedBy);
    }

    const startedAt = Date.now();
    try {
      const output = await tool.execute(decision.input, toolInvocationFromTurn(this.turn));
      const durationMs = Date.now() - startedAt;
      if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, durationMs, causedBy);
      await this.#append({ type: 'tool_result', toolName: name, output, durationMs, toolUseId }, causedBy);
      return Object.freeze({ status: 'completed', output, durationMs });
    } catch (error) {
      if (error instanceof TurnJournalCommitError) throw error;
      const durationMs = Date.now() - startedAt;
      if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, durationMs, causedBy);
      if (error instanceof NetworkAccessDeniedError) {
        return this.#deny(name, toolUseId, error.policy, error.message, causedBy);
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.#append({ type: 'tool_failed', toolName: name, toolUseId, error: message, durationMs }, causedBy);
      return Object.freeze({ status: 'failed', error: message, retryable: false });
    }
  }

  async #deny(toolName: string, toolUseId: string, policy: string, reason: string, causedBy?: ToolExecutionCause): Promise<TurnToolOutcome> {
    await this.#append({ type: 'tool_denied', toolName, toolUseId, policy, reason }, causedBy);
    return Object.freeze({ status: 'denied', policy, reason });
  }

  async #cancel(toolName: string, toolUseId: string, durationMs: number, causedBy?: ToolExecutionCause): Promise<TurnToolOutcome> {
    const reason = this.turn.signal.reason instanceof Error
      ? this.turn.signal.reason.message
      : String(this.turn.signal.reason ?? 'turn cancelled');
    await this.#append({ type: 'tool_cancelled', toolName, toolUseId, reason, durationMs }, causedBy);
    return Object.freeze({ status: 'cancelled', reason });
  }

  async #append(event: ToolJournalEvent, causedBy?: ToolExecutionCause): Promise<void> {
    try {
      await this.turn.ports.journal.append(causedBy ? { ...event, causedBy } : event);
    } catch (error) {
      throw new TurnJournalCommitError(error);
    }
  }
}

/** Adapts canonical capability execution to the full AgentCore seam. */
export function turnToolExecutionAuthority(runtime: TurnToolRuntime): ToolExecutionAuthority {
  return Object.freeze({
    execute: (tool: AgentTool, input: Readonly<Record<string, unknown>>, toolUseId: string, cause?: ToolExecutionCause) =>
      runtime.execute(tool.name, input, toolUseId, cause),
  });
}

function freezeToolExecutionCause(cause?: ToolExecutionCause): ToolExecutionCause | undefined {
  if (!cause?.principal && !cause?.turn) return undefined;
  return Object.freeze({
    ...(cause.principal ? {
      principal: Object.freeze({
        ...cause.principal,
        ...(cause.principal.roles ? { roles: Object.freeze([...cause.principal.roles]) } : {}),
      }),
    } : {}),
    ...(cause.turn ? { turn: Object.freeze({ ...cause.turn }) } : {}),
  });
}
