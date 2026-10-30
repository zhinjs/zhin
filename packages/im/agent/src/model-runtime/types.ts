import type {
  AIConfig, AIProvider, LlmApiRuntime, AiHttpTransport,
} from '@zhin.js/ai';
import type { ModelCatalogConfig, ModelConnection, ResolvedInvocation, InvocationRequirements } from '@zhin.js/ai/model-catalog';
import type { ModelPolicyConfig, ModelPolicyResolveInput, EffectiveModelPolicy } from '../model-policy/types.js';
import type { RuntimePolicySnapshot } from '../model-policy/runtime-policy.js';
import type { HostModelCatalogConfig } from './authoring.js';
import type { PerceptionConfigInput } from '../config/perception-config.js';
import type { PersonalSessionSelection } from '../personal-session/types.js';

export type ModelRuntimeConfig = Omit<AIConfig, 'agents' | 'multimodal'> & {
  readonly multimodal?: Omit<NonNullable<AIConfig['multimodal']>, 'perception'> & { readonly perception?: PerceptionConfigInput };
  readonly modelCatalog?: HostModelCatalogConfig;
  readonly modelPolicy?: ModelPolicyConfig;
  readonly agents?: Readonly<Record<string, Readonly<{
    provider?: string; model?: string; preset?: string;
    mcpServers?: readonly string[]; nickname?: string; permission?: unknown;
  }>>>;
};
export interface ModelExecutionBundle {
  readonly provider: AIProvider;
  readonly llmRuntime: LlmApiRuntime;
  readonly invocation: ResolvedInvocation;
}
export interface ModelExecutionLease extends ModelExecutionBundle {
  release(): Promise<void>;
}
export type ModelSummarySource = 'runtime' | 'static' | 'deployment-chat';
export interface ModelExecutionScope {
  readonly chat: ModelExecutionBundle;
  readonly perception?: ModelExecutionBundle;
  readonly perceptionFallbacks?: readonly ModelExecutionBundle[];
  readonly summary?: ModelExecutionBundle;
  readonly policy: EffectiveModelPolicy;
  readonly summarySource?: ModelSummarySource;
  readonly policyRevision?: number;
  release(): Promise<void>;
}
export interface ModelTurnResolveInput {
  readonly origin?: ModelPolicyResolveInput['origin'];
  readonly rootId: string;
  readonly ownerId: string;
  readonly sessionSelection?: PersonalSessionSelection;
  readonly bindingName?: string;
}
export interface ResolvedModelExecutionScope {
  readonly chat: ResolvedInvocation;
  readonly perception?: ResolvedInvocation;
  readonly perceptionFallbacks?: readonly ResolvedInvocation[];
  readonly summary?: ResolvedInvocation;
  readonly policy: EffectiveModelPolicy;
  readonly summarySource?: ModelSummarySource;
  readonly policyRevision?: number;
}
export interface ModelRuntimeServiceOptions {
  readonly config: ModelRuntimeConfig;
  readonly hostOwnerId: string;
  /** Canonical Host address; required for persisted runtime policy, absent for historical static embedders. */
  readonly rootId?: string;
  /** Read once per turn; failures must never become an empty override. */
  readonly runtimePolicySnapshot?: () => Promise<RuntimePolicySnapshot>;
  /** Borrowed Host instances keep their external owner and are never disposed here. */
  readonly hostProviders?: ReadonlyMap<string, AIProvider>;
  /** An explicit owner may transfer an admitted Provider's disposer to its lease lifetime. */
  readonly takeHostProviderOwnership?: (provider: AIProvider) => (() => void | Promise<void>) | undefined;
  readonly secretResolver?: (connection: ModelConnection) => Promise<string | undefined>;
  /** Trusted Host snapshot; no network or implicit discovery occurs during resolution. */
  readonly personalCatalogSnapshot?: (ownerId: string) => ModelCatalogConfig | undefined | Promise<ModelCatalogConfig | undefined>;
  readonly personalFetchFactory?: (connection: ModelConnection) => typeof globalThis.fetch | undefined;
  /** Host execution seam; constructing it must not read environment configuration here. */
  readonly hostTransportFactory?: (connection: ModelConnection) => AiHttpTransport;
}
export interface ResolvePresetOptions {
  readonly ownerId: string;
  readonly requirements?: InvocationRequirements;
}
export type ModelRuntimeErrorCode = 'invalid-config' | 'migration-model-missing' | 'migration-provider-missing' | 'migration-default-missing' | 'unknown-binding' | 'catalog-conflict' | 'chat-preset-missing' | 'host-connection-unavailable' | 'personal-transport-unavailable' | 'deployment-owner-mismatch';
export class ModelRuntimeError extends Error {
  constructor(readonly code: ModelRuntimeErrorCode) {
    super(`Model runtime: ${code}`);
    this.name = 'ModelRuntimeError';
  }
}
