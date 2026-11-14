import type { AgentStartupConfig } from '../config/agent-startup.js';
import type { LlmCompletionPort, Model, ModelAvailabilityRegistry, ModelFallbackEvent } from '@zhin.js/ai';
import type {
  ExecutionBinding, InferenceClient, InferenceGraphSnapshot, InferenceOperationScope, InferenceRuntime, ProviderCallContext, ProviderGraph,
} from '@zhin.js/ai/provider';
import type { SnapshotLease, SnapshotReader } from '@zhin.js/plugin-runtime';
import type { TurnRequest } from '../turn/turn-ingress.js';
import type { PerceptionSettingsInput } from '../config/perception-config.js';
import type { ResolvedAgentBinding } from '../config/types.js';

/** Startup Agent behavior only. Model/account selection is persisted in the inference graph. */
export type ModelRuntimeConfig = Omit<AgentStartupConfig, 'agents' | 'multimodal'> & {
  readonly multimodal?: Omit<NonNullable<AgentStartupConfig['multimodal']>, 'perception'> & { readonly perception?: PerceptionSettingsInput };
  readonly agents?: Readonly<Record<string, Readonly<{
    mcpServers?: readonly string[]; nickname?: string;
    permission?: Readonly<{ task?: Readonly<Record<string, 'allow' | 'deny'>> }>;
  }>>>;
};
export interface ModelExecutionBundle {
  readonly binding: ExecutionBinding;
  readonly model: Model;
  readonly completion: LlmCompletionPort;
}
/** A declaration in the captured graph; Driver validation occurs only when consumed. */
export interface ModelExecutionCandidate {
  readonly binding: ExecutionBinding;
  resolve(): Promise<ModelExecutionBundle>;
}
export interface ModelExecutionLease extends ModelExecutionBundle { release(): Promise<void> }
export type ModelSummarySource = 'runtime' | 'deployment-chat';
/**
 * A queued child owns this reservation independently of its parent's turn.
 * Each `acquire` opens one child operation (released by its own `release`);
 * `release` ends the reservation and every child still open. The reservation
 * also ends when the leased generation retires, so it never holds a reload.
 */
export interface ModelDelegationAuthority {
  acquire(input: Readonly<{
    operationId: string;
    sessionKey: string;
    epoch?: string;
    bindingName?: string;
    /**
     * Sub-agent: selects its `agent:<key>` purpose when one is configured,
     * otherwise the chat purpose (#1250 agent-purpose-binding-ignored).
     */
    agent?: SubAgentModelKey;
    signal?: AbortSignal;
  }>): Promise<ModelExecutionScope>;
  release(): Promise<void>;
}
export interface ModelExecutionScope {
  readonly chat: ModelExecutionBundle;
  /** Purpose `chat` was selected for (`chat` or `agent:<name>`). */
  readonly purpose?: 'chat' | `agent:${string}`;
  readonly perception?: ModelExecutionCandidate;
  readonly perceptionFallbacks?: readonly ModelExecutionCandidate[];
  readonly summary?: ModelExecutionCandidate;
  readonly graph: ProviderGraph;
  readonly context: ProviderCallContext;
  readonly inference: InferenceClient;
  readonly inferenceSnapshot: InferenceGraphSnapshot;
  readonly resolve: InferenceOperationScope['resolve'];
  readonly summarySource: ModelSummarySource;
  readonly policyRevision: number;
  /**
   * Switches of this operation to a purpose fallback (#1250 chat-purpose-no-fallback).
   * `chat` is already the answering model when the primary was skipped at selection.
   */
  readonly modelFallbacks?: () => readonly ModelFallbackEvent[];
  /** Replays earlier switches, then reports new ones; the returned function stops it. */
  readonly observeModelFallback?: (listener: (event: ModelFallbackEvent) => void) => () => void;
  retainDelegation(): ModelDelegationAuthority;
  release(): Promise<void>;
}
export interface ModelTurnResolveInput {
  readonly request: TurnRequest;
  readonly binding: ResolvedAgentBinding;
}
export interface ModelTurnAcquireInput extends ModelTurnResolveInput {
  readonly lease: SnapshotLease;
  readonly snapshots: SnapshotReader;
  readonly inferenceSnapshot?: InferenceGraphSnapshot;
}
/** Host-created auxiliary operation; no fabricated IM request or latest-generation lookup. */
export interface ModelContextAcquireInput {
  readonly inferenceSnapshot?: InferenceGraphSnapshot;
  readonly lease: SnapshotLease;
  readonly snapshots: SnapshotReader;
  readonly context: ProviderCallContext;
  readonly bindingName?: string;
  /** See {@link ModelDelegationAuthority.acquire}: configured `agent:<key>` purpose, else chat. */
  readonly agent?: SubAgentModelKey;
  readonly signal?: AbortSignal;
}
/**
 * How a sub-agent is looked up in `purposes.agents`: `qualifiedName`
 * (`<plugin>__<agent>`) first; the bare `name` only when no other sub-agent
 * shares it and no Agent binding uses it.
 */
export interface SubAgentModelKey {
  readonly name: string;
  readonly qualifiedName?: string;
  /** Another sub-agent registered for the turn has the same bare name. */
  readonly bareNameShared?: boolean;
}
export interface ModelRuntimeServiceOptions {
  readonly rootId: string;
  readonly hostOwnerId: string;
  /** The actual operation lease; candidate setup cannot acquire an older/latest generation. */
  readonly inferenceFactory: (input: Readonly<{ lease: SnapshotLease; snapshots: SnapshotReader }>) => InferenceRuntime;
  readonly context: (input: ModelTurnResolveInput) => ProviderCallContext | Promise<ProviderCallContext>;
  /** Agent binding names (`ai.agents.<name>`; `zhin` is implied): `purposes.agents` keys a sub-agent never uses. */
  readonly bindingNames?: () => Iterable<string>;
  /** Skip state of models that failed with quota / billing / auth; defaults to the process-wide one. */
  readonly modelAvailability?: ModelAvailabilityRegistry;
}
export type ModelRuntimeErrorCode = 'not-prepared' | 'invalid-context' | 'unknown-binding';
export class ModelRuntimeError extends Error {
  constructor(readonly code: ModelRuntimeErrorCode) {
    super(`Model runtime: ${code}`);
    this.name = 'ModelRuntimeError';
  }
}
