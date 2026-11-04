import type { ConversationRef } from '@zhin.js/im-contract';
import type { PersonalSessionSelection } from '../personal-session/types.js';

/** The one allowlist for compiling all model-policy scopes. */
export const MODEL_POLICY_SCOPE_FIELDS = Object.freeze({
  default: Object.freeze(['chat', 'perception', 'summary'] as const),
  adapter: Object.freeze(['chat', 'perception'] as const),
  endpoint: Object.freeze(['chat', 'perception'] as const),
  scene: Object.freeze(['chat'] as const),
  session: Object.freeze(['chat'] as const),
});
export type ModelPurpose = typeof MODEL_POLICY_SCOPE_FIELDS.default[number];
export type ModelPolicyScope = keyof typeof MODEL_POLICY_SCOPE_FIELDS;
export type ModelPolicyFields<Scope extends ModelPolicyScope> = Readonly<Partial<Record<
  typeof MODEL_POLICY_SCOPE_FIELDS[Scope][number], string
>>>;
export type ModelPolicyRefs = ModelPolicyFields<'default'>;
export type ModelPolicyPatch = ModelPolicyFields<'adapter'>;

export interface ModelPolicyEndpointAddress {
  readonly rootId: string;
  readonly platform: string;
  /** Live Endpoint instance, distinct from the canonical Adapter entry. */
  readonly endpoint: string;
  /** Canonical Adapter entry: ConversationRef.endpoint.id, possibly containing NUL. */
  readonly adapterId: string;
}
export interface ModelPolicySceneAddress {
  readonly rootId: string;
  readonly platform: string;
  readonly endpoint: string;
  readonly conversation: ConversationRef;
}
export interface ModelPolicyConfig {
  readonly defaults: ModelPolicyRefs;
  readonly adapters?: Readonly<Record<string, ModelPolicyPatch>>;
  readonly endpoints?: readonly Readonly<{ address: ModelPolicyEndpointAddress; models: ModelPolicyPatch }>[];
  readonly scenes?: readonly Readonly<{ address: ModelPolicySceneAddress; models: ModelPolicyFields<'scene'> }>[];
}
export interface ModelPolicyResolveInput {
  readonly rootId: string;
  readonly origin: Readonly<{ platform: string; endpoint: string; conversation: ConversationRef }>;
  readonly session?: Readonly<{ chat?: PersonalSessionSelection }>;
}
export type ModelPolicySource =
  | Readonly<{ level: 'default'; rootId: string }>
  | Readonly<{ level: 'adapter'; rootId: string; platform: string }>
  | Readonly<{ level: 'endpoint'; address: ModelPolicyEndpointAddress }>
  | Readonly<{ level: 'scene'; address: ModelPolicySceneAddress }>
  | Readonly<{ level: 'session'; address: ModelPolicySceneAddress }>;
export interface EffectiveModelPolicy {
  readonly refs: ModelPolicyRefs;
  readonly sources: Readonly<Partial<Record<ModelPurpose, ModelPolicySource>>>;
}

export class ModelPolicyValidationError extends Error {
  readonly code = 'invalid_model_policy';
  constructor(readonly path: string, reason: string) {
    super(`Invalid model policy at ${path}: ${reason}`);
    this.name = 'ModelPolicyValidationError';
  }
}
