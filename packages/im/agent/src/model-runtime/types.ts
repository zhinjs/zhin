import type { AgentStartupConfig } from '../config/agent-startup.js';
import type { LlmCompletionPort, Model } from '@zhin.js/ai';
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
export interface ModelExecutionLease extends ModelExecutionBundle { release(): Promise<void> }
export type ModelSummarySource = 'runtime' | 'deployment-chat';
/** A queued child owns this reservation independently of its parent's turn. */
export interface ModelDelegationAuthority {
  acquire(input: Readonly<{ operationId: string; sessionKey: string; epoch?: string; bindingName?: string; signal?: AbortSignal }>): Promise<ModelExecutionScope>;
  release(): Promise<void>;
}
export interface ModelExecutionScope {
  readonly chat: ModelExecutionBundle;
  readonly perception?: ModelExecutionBundle;
  readonly perceptionFallbacks?: readonly ModelExecutionBundle[];
  readonly summary?: ModelExecutionBundle;
  readonly graph: ProviderGraph;
  readonly context: ProviderCallContext;
  readonly inference: InferenceClient;
  readonly inferenceSnapshot: InferenceGraphSnapshot;
  readonly resolve: InferenceOperationScope['resolve'];
  readonly summarySource: ModelSummarySource;
  readonly policyRevision: number;
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
  readonly signal?: AbortSignal;
}
export interface ModelRuntimeServiceOptions {
  readonly rootId: string;
  readonly hostOwnerId: string;
  /** The actual operation lease; candidate setup cannot acquire an older/latest generation. */
  readonly inferenceFactory: (input: Readonly<{ lease: SnapshotLease; snapshots: SnapshotReader }>) => InferenceRuntime;
  readonly context: (input: ModelTurnResolveInput) => ProviderCallContext | Promise<ProviderCallContext>;
}
export type ModelRuntimeErrorCode = 'not-prepared' | 'invalid-context' | 'unknown-binding';
export class ModelRuntimeError extends Error {
  constructor(readonly code: ModelRuntimeErrorCode) {
    super(`Model runtime: ${code}`);
    this.name = 'ModelRuntimeError';
  }
}
