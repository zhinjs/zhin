import type { DecisionQuestions, DecisionResult, JsonValue } from '../decision/types.js';
import type { AssistantMessage } from '../llm/types/agent-message.js';
import type { AssistantStreamEvent } from '../llm/llm-api-runtime.js';
import type { ImageGenerateRequest, ImageGenerateResult } from '../image-generation.js';
import type { AuthenticationMethod, ExecutionBinding, JsonObject, LanguageRequest, ProviderCallContext, ProviderService, ProviderDriverReference, ModelDefinition, ModelKind, ModelProfile } from './types.js';
import type { ProviderBindingResources } from './resources.js';

/** Parsing stays with the driver; no dependency on one validation library. */
export interface ProviderSchema<T> {
  /** Same authored schema as parse; public metadata contains no client/credential material. */
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  parse(input: unknown): T;
}
export interface ProviderModelContract {
  readonly protocol: string;
  readonly kinds: readonly ModelKind[];
}
export interface CredentialGrant {
  readonly token?: string;
  /** Driver-private routing facts from this account's encrypted bundle, not identity proof. */
  readonly metadata?: JsonObject;
  readonly headers: Readonly<Record<string, string>>;
  readonly revision: string;
}
export interface CredentialPort {
  /** Host-private proof of the exact grant used for this actual request. The
   * returned Request is forwarded to the controlled fetch unchanged. */
  bindRequest(input: Readonly<{ grant: CredentialGrant; request: Request }>): Request;
  authorize(input: Readonly<{ target: URL; signal: AbortSignal }>): Promise<CredentialGrant>;
}
export interface ProviderCreateExecutionOptions<S = JsonObject, P = JsonObject> {
  readonly binding: ExecutionBinding<S, P>;
  readonly credentials: CredentialPort;
  readonly context: ProviderCallContext;
  readonly resources: ProviderBindingResources;
  /** Host network policy has already been applied; credentials still check the target. */
  readonly fetch: typeof globalThis.fetch;
  readonly signal: AbortSignal;
}
export interface ProviderExecution {
  readonly language?: {
    generate(input: Readonly<{ request: LanguageRequest; signal: AbortSignal }>): Promise<AssistantMessage>;
    stream(input: Readonly<{ request: LanguageRequest; signal: AbortSignal }>): Promise<AsyncIterable<AssistantStreamEvent>>;
  };
  readonly decision?: {
    evaluate<const Q extends DecisionQuestions>(input: Readonly<{
      state: JsonValue; questions: Q; timeoutMs?: number; signal: AbortSignal;
    }>): Promise<DecisionResult<Q>>;
  };
  readonly image?: {
    generate(input: Readonly<{ request: Omit<ImageGenerateRequest, 'model'>; signal: AbortSignal }>): Promise<ImageGenerateResult>;
  };
  dispose?(): void | Promise<void>;
}
export interface OAuthCredential {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
  readonly subject?: string;
  readonly metadata?: JsonObject;
  readonly preparation?: Readonly<{
    status: 'required' | 'ready';
    code?: 'identity-unavailable' | 'project-unavailable';
  }>;
}
export interface OAuthOperationOptions<S = JsonObject> {
  readonly service: ProviderService<S>;
  readonly fetch: typeof globalThis.fetch;
  readonly signal: AbortSignal;
  /** Account-bound confidential OAuth client material; never a Service option. */
  readonly client?: Readonly<{ clientSecret?: string }>;
}
export interface OAuthChallenge {
  readonly authorizationUrl: string;
  readonly state: string;
  /** Host-private material, never sent to Console or exported. */
  readonly privateState: JsonObject;
}
export interface OAuthAuthentication<S = JsonObject> {
  readonly contractVersion: string;
  /** Product callback contract, not a request-body redirect or an HTTP listener. */
  readonly redirectUri: string;
  begin(input: OAuthOperationOptions<S> & Readonly<{ redirectUri: string }>): Promise<OAuthChallenge>;
  complete(input: OAuthOperationOptions<S> & Readonly<{
    redirectUri: string; code: string; state: string; challenge: OAuthChallenge;
  }>): Promise<OAuthCredential>;
  refresh(input: OAuthOperationOptions<S> & Readonly<{ credential: OAuthCredential }>): Promise<OAuthCredential>;
  /** Explicit post-login read-only preparation. Host retains the exchanged bundle
   * if this fails; retrying preparation must not re-exchange the authorization code. */
  prepare?(input: OAuthOperationOptions<S> & Readonly<{ credential: OAuthCredential }>): Promise<OAuthCredential>;
}
export interface ProviderAuthentication<S = JsonObject> {
  readonly methods: readonly AuthenticationMethod[];
  readonly oauth?: OAuthAuthentication<S>;
}
/** Absolute URL prefixes. Hosts compare normalized origin and path boundaries,
 * never substring-match hosts; no credentials or query strings are permitted. */
export interface ProviderTargets {
  readonly authentication: readonly string[];
  readonly inference: readonly string[];
  readonly identity?: readonly string[];
  readonly discovery?: readonly string[];
}
/** A provider-observed ID is not an execution capability or an admitted ModelDefinition. */
export interface ProviderModelObservation {
  readonly id: string;
  readonly label?: string;
}
export interface ProviderDiscoveryOptions<S = JsonObject> {
  readonly service: ProviderService<S>;
  readonly credentials: CredentialPort;
  readonly fetch: typeof globalThis.fetch;
  readonly signal: AbortSignal;
}
export interface ProviderExecutionPolicy {
  /** Same-model retries after the first attempt; zero explicitly disables them. */
  readonly maxRetries?: number;
  /** Whole-attempt timeout; zero explicitly disables it. */
  readonly requestTimeoutMs?: number;
}
export interface ProviderExecutionTraits {
  /** Parsed Profile controls, projected by the selected Driver, never SDK config. */
  readonly executionPolicy?: ProviderExecutionPolicy;
  readonly promptFamily?: string;
  readonly nativeDeferredTools?: boolean;
  /** The protocol owns cache routing; framework-generated routing hints are omitted. */
  readonly promptCacheRouting?: 'driver';
  readonly midConversationSystem?: 'system' | 'developer' | 'none';
}
export interface DescribeProviderModelInput<S = JsonObject, P = JsonObject> {
  readonly service: ProviderService<S>;
  readonly profile: ModelProfile<P>;
  readonly model: ModelDefinition;
}
/** Display classification only; neither supplier authorization nor account readiness. */
export interface ProviderSupportMetadata {
  readonly status: 'standard' | 'experimental';
  /** Plain text for selected details or a login flow, never model instructions. */
  readonly notice?: string;
}
export interface ProviderDefinition<S = JsonObject, P = JsonObject> {
  readonly id: string;
  readonly contractVersion: string;
  readonly label?: string;
  readonly support?: ProviderSupportMetadata;
  readonly modelContracts?: readonly ProviderModelContract[];
  readonly serviceSchema: ProviderSchema<S>;
  /** Parameters depend on the selected protocol/model, not only the product. */
  profileSchema?(input: Readonly<{ service: ProviderService<S>; model: ModelDefinition }>): ProviderSchema<P>;
  readonly authentication: ProviderAuthentication<S>;
  targets(service: ProviderService<S>): ProviderTargets;
  /** Pure offline validation/catalog. Discovery is an explicit management action. */
  models(service: ProviderService<S>): Readonly<Record<string, ModelDefinition>>;
  /** Pure credential-audience identity. Omit only when every option is identity-bearing. */
  identity?(service: ProviderService<S>): JsonValue;
  /** Explicit authenticated management action; observations require a separate reviewed graph edit. */
  discover?(input: ProviderDiscoveryOptions<S>): Promise<readonly ProviderModelObservation[]>;
  /** Pure traits of the already validated protocol, with no credential or SDK handle. */
  describeModel?(input: DescribeProviderModelInput<S, P>): ProviderExecutionTraits;
  createExecution(options: ProviderCreateExecutionOptions<S, P>): ProviderExecution | Promise<ProviderExecution>;
}
/** Parsed parameter inference comes from the schema resolver, never from execution code. */
export function defineProvider<
  const S,
  const P = JsonObject,
  const Id extends string = string,
  const Methods extends readonly AuthenticationMethod[] = readonly AuthenticationMethod[],
>(definition: Omit<ProviderDefinition<S, NoInfer<P>>, 'id' | 'authentication' | 'profileSchema'> & Readonly<{
  id: Id;
  profileSchema?: (input: Readonly<{ service: ProviderService<S>; model: ModelDefinition }>) => ProviderSchema<P>;
  authentication: Omit<ProviderAuthentication<S>, 'methods'> & Readonly<{ methods: Methods }>;
}>): ProviderDefinition<S, P> & Readonly<{
  id: Id;
  authentication: ProviderAuthentication<S> & Readonly<{ methods: Methods }>;
}> {
  return Object.freeze(definition);
}

export interface ProviderDriverLease {
  readonly reference: ProviderDriverReference;
  readonly definition: ProviderDefinition<unknown, unknown>;
  release(): void | Promise<void>;
}
export interface ProviderDriverResolver {
  acquire(input: Readonly<{ service: ProviderService; signal: AbortSignal }>): Promise<ProviderDriverLease>;
}
