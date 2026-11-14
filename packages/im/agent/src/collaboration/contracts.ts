/**
 * ADR 0048 H2 — collaboration contracts for the agent layer.
 *
 * Three pieces implement these independently and are composed by the turn
 * engine (`plugin-runtime/full-agent-turn-engine.ts`):
 *
 * - `directory.ts`    agent definitions (agents/<name>/agent.json) → {@link CollaborationDirectory}
 * - `tools.ts`        the model-facing collaboration tools → {@link createCollaborationTools}
 * - `actor-turn.ts`   one actor turn over a mail batch → {@link ActorTurnRunnerFactory}
 *
 * The live IM turn is the engagement's root actor: the engine `attach`es it
 * to a per-turn {@link Harness} and gives it the collaboration tools bound to
 * the root mail. Every other actor's turn runs through the actor runner, which
 * receives the same tools bound to its own mail, so any actor can ask,
 * delegate and tell within its attenuated authority.
 */
import type { ActorId, AgentCeiling, AgentName, BudgetAmounts, Harness, Mail } from '@zhin.js/harness';
import type { ToolCapability } from '../plugin-runtime/capability-ingress.js';
import type { ModelExecutionScope } from '../model-runtime/types.js';

/**
 * Host-owned model operations for actor turns (#1250): each actor turn opens
 * its own operation, independent of the root turn's (which closes when the
 * root turn ends).
 */
export interface ActorModelSource {
  acquire(input: Readonly<{
    operationId: string;
    sessionKey: string;
    signal: AbortSignal;
  }>): Promise<ModelExecutionScope>;
}

/** Model chosen for the root turn; actor turns reuse it without an {@link ActorModelSource}. */
export interface ActorModelSelection {
  readonly modelId: string;
  readonly modelCandidates: readonly string[];
}

/** One collaborating agent, resolved for a turn. */
export interface CollaborationAgent {
  readonly name: AgentName;
  readonly displayName: string;
  /** One line shown by the `agents` tool. */
  readonly description: string;
  /** Persona and rules from the agent's Markdown entry points. */
  readonly instructions: string;
  readonly ceiling: AgentCeiling;
  readonly model?: string;
  readonly maxIterations?: number;
  /** Default collaboration budget from `agents/<name>/agent.json` `collaboration.budget`. */
  readonly defaultBudget?: Partial<BudgetAmounts>;
}

export interface CollaborationDirectory {
  /** The agent that receives human messages in this turn (the root actor). */
  readonly entry: CollaborationAgent;
  get(name: AgentName): CollaborationAgent | undefined;
  list(): readonly CollaborationAgent[];
}

/** What a collaboration tool needs to act for the actor that is currently running. */
export interface CollaborationBinding {
  readonly harness: Harness;
  readonly directory: CollaborationDirectory;
  /** The running actor. */
  readonly actor: ActorId;
  /** The mail this actor's current turn is processing. */
  readonly mail: Mail;
}

/** Tool names; reserved built-ins (see `reserved-tools.ts`). */
export const COLLABORATION_TOOL_NAMES = Object.freeze({
  agents: 'agents',
  ask: 'ask',
  delegate: 'delegate',
  tell: 'tell',
  followUp: 'follow_up',
  boardRead: 'board_read',
  boardWrite: 'board_write',
  cancel: 'cancel_delegation',
  escalate: 'escalate',
} as const);

export type CollaborationToolName = (typeof COLLABORATION_TOOL_NAMES)[keyof typeof COLLABORATION_TOOL_NAMES];

/**
 * Creates the collaboration tools for one running actor. `owner` is the
 * capability owner of the turn (`AgentCapabilities.owner`). The `escalate`
 * tool resolves through `onEscalate`, which the engine wires to the root
 * turn's question / reply ports.
 */
export type CreateCollaborationTools = (
  binding: CollaborationBinding,
  options: Readonly<{
    owner: ToolCapability['owner'];
    onEscalate?: (reason: string) => Promise<string>;
    onVenueTell?: (venue: string, content: string) => Promise<void>;
  }>,
) => readonly ToolCapability[];

export { type ActorTurnRunner } from '@zhin.js/harness';
