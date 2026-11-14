import type { JsonValue, DecisionQuestions, DecisionResult } from '../decision/types.js';
import type { Context } from '../llm/types/context.js';
import type { AssistantMessage } from '../llm/types/agent-message.js';
import type { AssistantStreamEvent, StreamOptions } from '../llm/llm-api-runtime.js';
import type { ImageGenerateRequest, ImageGenerateResult } from '../image-generation.js';

export type JsonObject = Readonly<Record<string, JsonValue>>;
export type ModelKind = 'language' | 'decision' | 'image';
export type AuthenticationMethod = 'none' | 'api-key' | 'oauth';
export type DecisionPurpose = 'skills' | 'tools' | 'memory' | 'agents' | 'approval' | 'ambient';
export type LanguagePurpose = 'chat' | 'summary' | 'perception' | 'ambient';
export type InferencePurpose = LanguagePurpose | 'image' | `decision:${DecisionPurpose}` | `agent:${string}`;

/** Public resource identity. Labels and import aliases never confer ownership. */
export interface ProviderResource {
  readonly id: string;
  readonly rootId: string;
  readonly ownerId: string;
  readonly revision: number;
  readonly label?: string;
}
export interface ProviderDriverReference {
  readonly id: string;
  readonly owner: string;
  readonly contractVersion: string;
}
export interface ModelDefinition {
  readonly id: string;
  readonly kinds: readonly ModelKind[];
  readonly protocol: string;
  readonly input?: readonly ('text' | 'image' | 'audio' | 'video' | 'file')[];
  readonly streaming?: boolean;
  readonly toolCalling?: boolean;
  readonly thinking?: boolean;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
}
export interface ProviderService<Options = JsonObject> extends ProviderResource {
  readonly driver: ProviderDriverReference;
  readonly options: Options;
  readonly models: Readonly<Record<string, ModelDefinition>>;
}
export type AccountAuthentication =
  | Readonly<{ method: 'none' }>
  | Readonly<{ method: 'api-key'; source?: string }>
  | Readonly<{ method: 'oauth' }>;
/** Authentication state is a private-record projection, not a graph revision. */
export interface ProviderAccount extends ProviderResource {
  readonly serviceId: string;
  readonly incarnation: string;
  readonly authentication: AccountAuthentication;
}
export interface ModelProfile<Parameters = JsonObject> extends ProviderResource {
  readonly accountId: string;
  readonly model: string;
  readonly parameters: Parameters;
}
export interface PerceptionSelection {
  readonly profile: string;
  /** An explicitly configured chain only; never a general account fallback. */
  readonly fallbacks?: readonly string[];
}
export interface DecisionPurposePolicy {
  readonly profile?: string;
  readonly mode: 'off' | 'shadow' | 'active';
  readonly timeoutMs?: number;
  readonly minConfidence?: number;
  readonly topK?: number;
  readonly maxCandidates?: number;
  readonly maxSelections?: number;
}
export interface ScopedModelSelection {
  readonly chat?: string;
  readonly perception?: PerceptionSelection;
}
export interface PurposePolicy {
  readonly defaults: ScopedModelSelection & Readonly<{ summary?: string; image?: string; ambient?: string }>;
  readonly decisions?: Readonly<Partial<Record<DecisionPurpose, DecisionPurposePolicy>>>;
  readonly agents?: Readonly<Record<string, string>>;
  readonly adapters?: Readonly<Record<string, ScopedModelSelection>>;
  readonly endpoints?: Readonly<Record<string, ScopedModelSelection>>;
  readonly scenes?: Readonly<Record<string, Readonly<{ chat?: string }>>>;
}
export interface ProviderGraph {
  readonly rootId: string;
  readonly revision: number;
  readonly services: Readonly<Record<string, ProviderService>>;
  readonly accounts: Readonly<Record<string, ProviderAccount>>;
  readonly profiles: Readonly<Record<string, ModelProfile>>;
  readonly purposes: PurposePolicy;
}

declare const profileKind: unique symbol;
/** A typed reference, not a permission token. Revalidated for every operation. */
export interface ProfileRef<K extends ModelKind = ModelKind> {
  readonly id: string;
  readonly rootId: string;
  readonly revision: number;
  readonly accountId: string;
  readonly accountIncarnation: string;
  readonly kind: K;
  readonly [profileKind]: K;
}
/** Durable selection pins resource/account identity, not a past configuration revision. */
export interface ProfileSelection<K extends ModelKind = ModelKind> {
  readonly id: string;
  readonly rootId: string;
  readonly accountId: string;
  readonly accountIncarnation: string;
  readonly kind: K;
}
export interface ProfileView<K extends ModelKind> {
  readonly reference: ProfileRef<K>;
  readonly label: string;
  readonly model: string;
  readonly accountId: string;
  readonly serviceId: string;
  readonly definition: ModelDefinition;
}
/** Trusted Host input; never populated from a model or message body. */
export interface ProviderCallContext {
  readonly rootId: string;
  readonly ownerId: string;
  readonly hostOwnerId: string;
  readonly operationId: string;
  readonly sessionKey?: string;
  readonly epoch?: string;
  readonly adapterKey?: string;
  readonly endpointKey?: string;
  readonly sceneKey?: string;
  readonly sessionChat?: ProfileSelection<'language'>;
}
/** Derived alongside selection, never an independent configuration authority. */
export type ProviderSelectionSource =
  | Readonly<{ level: 'profile'; profileId: string }>
  | Readonly<{ level: 'session' }>
  | Readonly<{ level: 'scene' | 'endpoint' | 'adapter'; key: string }>
  | Readonly<{ level: 'default'; purpose: InferencePurpose; inheritedFrom?: 'chat' }>
  | Readonly<{ level: 'agent'; name: string }>
  | Readonly<{ level: 'decision'; task: DecisionPurpose }>;
export interface ExecutionBinding<ServiceOptions = JsonObject, ModelParameters = JsonObject> {
  readonly graphRevision: number;
  readonly source?: ProviderSelectionSource;
  readonly service: ProviderService<ServiceOptions>;
  readonly account: ProviderAccount;
  readonly profile: ModelProfile<ModelParameters>;
  readonly model: ModelDefinition;
}
export interface LanguageRequest {
  readonly context: Context;
  readonly options?: Omit<StreamOptions, 'signal'>;
}
export interface GenerateInput {
  readonly purpose?: LanguagePurpose | `agent:${string}`;
  readonly profile?: ProfileRef<'language'>;
  readonly request: LanguageRequest;
  readonly signal?: AbortSignal;
}
export interface EvaluateDecisionInput<Q extends DecisionQuestions> {
  readonly profile: ProfileRef<'decision'>;
  readonly state: JsonValue;
  readonly questions: Q;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}
export interface GenerateImageInput {
  readonly profile?: ProfileRef<'image'>;
  readonly request: Omit<ImageGenerateRequest, 'model'>;
  readonly signal?: AbortSignal;
}
export interface ProfileQuery<K extends ModelKind> { readonly kind: K }
export interface LanguageRun extends AsyncIterable<AssistantStreamEvent>, AsyncDisposable {
  close(): Promise<void>;
}
export interface InferenceClient extends AsyncDisposable {
  list<K extends ModelKind>(input: ProfileQuery<K>): Promise<readonly ProfileView<K>[]>;
  generate(input: GenerateInput): Promise<AssistantMessage>;
  stream(input: GenerateInput): Promise<LanguageRun>;
  evaluate<const Q extends DecisionQuestions>(input: EvaluateDecisionInput<Q>): Promise<DecisionResult<Q>>;
  generateImage(input: GenerateImageInput): Promise<ImageGenerateResult>;
  close(): Promise<void>;
}

export type ProviderErrorCode = 'invalid-graph' | 'not-configured' | 'profile-not-found' | 'forbidden'
  | 'stale-reference' | 'unsupported-capability' | 'driver-unavailable' | 'driver-contract-mismatch'
  | 'operation-closed' | 'multiple-stream-consumers' | 'invalid-plan' | 'plan-conflict'
  /** A referenced Service's address would move to another scheme / host / port (#1250). */
  | 'service-origin-change';
export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode) { super(`AI provider: ${code}`); this.name = 'ProviderError'; }
}

/** A Host admission denial proven to precede submission; transports must not retry it as network failure. */
export class ProviderAdmissionError extends Error {
  override name = 'ProviderAdmissionError';
}
