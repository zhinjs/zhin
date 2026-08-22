import { createHash, timingSafeEqual } from 'node:crypto';

export type WorkroomA2aCredentialReference =
  | Readonly<{ source: 'config'; value: string }>
  | Readonly<{ source: 'secure_provider'; secretRef: string }>;

export interface WorkroomA2aAuthBindingInput {
  readonly endpointId: string;
  readonly tenantId: string;
  readonly cardDigest: string;
  readonly authBindingId: string;
  readonly trustDomain: string;
  readonly extensionDigest: string;
  readonly credentialId: string;
  readonly credential: WorkroomA2aCredentialReference;
  readonly enabled: boolean;
  readonly expiresAt?: number;
}

export interface WorkroomA2aSecureCredentialProvider {
  resolve(secretRef: string): string | undefined;
}

export interface WorkroomA2aAuthRegistryOptions {
  readonly generation: number;
  readonly bindings: readonly WorkroomA2aAuthBindingInput[];
  readonly secureCredentialProvider?: WorkroomA2aSecureCredentialProvider;
  readonly now?: () => number;
}

export interface WorkroomA2aEndpointAuthoritySnapshot {
  readonly version: 1;
  readonly endpointId: string;
  readonly tenantId: string;
  readonly cardDigest: string;
  readonly authBindingId: string;
  readonly trustDomain: string;
  readonly generation: number;
  readonly extensionDigest: string;
  readonly credentialIdDigest: string;
}

export interface WorkroomA2aRegisteredAuthBindingSnapshot
extends WorkroomA2aEndpointAuthoritySnapshot {
  readonly enabled: boolean;
  readonly expiresAt?: number;
}

export interface WorkroomA2aAuthRegistrySnapshot {
  readonly version: 1;
  readonly generation: number;
  readonly bindings: readonly WorkroomA2aRegisteredAuthBindingSnapshot[];
}

interface CompiledBinding {
  readonly credentialDigest: Buffer;
  /** Trusted transport-only secret; never exposed through snapshots or serialization. */
  readonly credential: string;
  readonly authority: WorkroomA2aEndpointAuthoritySnapshot;
  readonly enabled: boolean;
  readonly expiresAt?: number;
}

export class WorkroomA2aAuthenticationError extends Error {
  constructor() {
    super('Workroom A2A credential is unknown or inactive');
    this.name = 'WorkroomA2aAuthenticationError';
  }
}

/** Generation-owned immutable credential-to-endpoint authority registry. */
export class WorkroomA2aAuthRegistry {
  readonly #bindings: readonly CompiledBinding[];
  readonly #now: () => number;
  readonly snapshot: WorkroomA2aAuthRegistrySnapshot;

  constructor(options: WorkroomA2aAuthRegistryOptions) {
    validateOptions(options);
    this.#now = options.now ?? Date.now;
    const endpointIds = new Set<string>();
    const authBindingIds = new Set<string>();
    const credentialIds = new Set<string>();
    const credentialDigests = new Set<string>();
    const bindings: CompiledBinding[] = [];
    for (const input of options.bindings) {
      validateBinding(input);
      if (endpointIds.has(input.endpointId)) {
        throw new Error(`Workroom A2A endpoint binding drift: ${input.endpointId}`);
      }
      if (credentialIds.has(input.credentialId)) {
        throw new Error(`Workroom A2A duplicate credentialId: ${input.credentialId}`);
      }
      if (authBindingIds.has(input.authBindingId)) {
        throw new Error(`Workroom A2A authBindingId drift: ${input.authBindingId}`);
      }
      endpointIds.add(input.endpointId);
      authBindingIds.add(input.authBindingId);
      credentialIds.add(input.credentialId);
      const credential = resolveCredential(input.credential, options.secureCredentialProvider);
      const credentialDigest = hash(credential);
      const digestKey = credentialDigest.toString('hex');
      if (credentialDigests.has(digestKey)) {
        throw new Error('Workroom A2A duplicate credential value');
      }
      credentialDigests.add(digestKey);
      const authority = deepFreeze({
        version: 1 as const,
        endpointId: input.endpointId,
        tenantId: input.tenantId,
        cardDigest: input.cardDigest,
        authBindingId: input.authBindingId,
        trustDomain: input.trustDomain,
        generation: options.generation,
        extensionDigest: input.extensionDigest,
        credentialIdDigest: digestString(input.credentialId),
      });
      bindings.push({
        credentialDigest,
        credential,
        authority,
        enabled: input.enabled,
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      });
    }
    this.#bindings = Object.freeze(bindings);
    this.snapshot = deepFreeze({
      version: 1 as const,
      generation: options.generation,
      bindings: bindings.map(binding => ({
        ...binding.authority,
        enabled: binding.enabled,
        ...(binding.expiresAt === undefined ? {} : { expiresAt: binding.expiresAt }),
      })),
    });
  }

  /** Only the transport credential participates; callback claims are not an input. */
  authenticate(requestCredential: string): WorkroomA2aEndpointAuthoritySnapshot {
    if (typeof requestCredential !== 'string' || requestCredential.length === 0) {
      throw new WorkroomA2aAuthenticationError();
    }
    const candidate = hash(requestCredential);
    let matched: CompiledBinding | undefined;
    for (const binding of this.#bindings) {
      if (timingSafeEqual(candidate, binding.credentialDigest)) matched = binding;
    }
    const now = this.#now();
    if (!Number.isFinite(now)) throw new Error('Workroom A2A authentication clock must be finite');
    if (!matched || !matched.enabled
      || (matched.expiresAt !== undefined && now >= matched.expiresAt)) {
      throw new WorkroomA2aAuthenticationError();
    }
    return matched.authority;
  }

  /**
   * Issues the callback credential only to the trusted outbound transport.
   * The endpoint id is resolved against this exact generation and inactive
   * credentials fail closed just like inbound authentication.
   */
  callbackAuthorization(endpointId: string): string {
    text(endpointId, 'endpointId');
    const matched = this.#bindings.find(binding => binding.authority.endpointId === endpointId);
    const now = this.#now();
    if (!Number.isFinite(now)) throw new Error('Workroom A2A authentication clock must be finite');
    if (!matched || !matched.enabled
      || (matched.expiresAt !== undefined && now >= matched.expiresAt)) {
      throw new WorkroomA2aAuthenticationError();
    }
    return `Bearer ${matched.credential}`;
  }
}

function validateOptions(options: WorkroomA2aAuthRegistryOptions): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Workroom A2A auth registry options must be an object');
  }
  assertExactKeys(options, ['generation', 'bindings', 'secureCredentialProvider', 'now'], 'options');
  positiveInteger(options.generation, 'generation');
  if (!Array.isArray(options.bindings)) throw new Error('Workroom A2A bindings must be an array');
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new Error('Workroom A2A now must be a function');
  }
  if (options.secureCredentialProvider !== undefined
    && (!options.secureCredentialProvider
      || typeof options.secureCredentialProvider !== 'object'
      || typeof options.secureCredentialProvider.resolve !== 'function')) {
    throw new Error('Workroom A2A secure credential provider resolve must be a function');
  }
}

function validateBinding(input: WorkroomA2aAuthBindingInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Workroom A2A auth binding must be an object');
  }
  assertExactKeys(input, [
    'endpointId', 'tenantId', 'cardDigest', 'authBindingId', 'trustDomain',
    'extensionDigest', 'credentialId', 'credential', 'enabled', 'expiresAt',
  ], 'binding');
  for (const [label, value] of Object.entries({
    endpointId: input.endpointId,
    tenantId: input.tenantId,
    authBindingId: input.authBindingId,
    trustDomain: input.trustDomain,
    credentialId: input.credentialId,
  })) text(value, label);
  canonicalDigest(input.cardDigest, 'cardDigest');
  canonicalDigest(input.extensionDigest, 'extensionDigest');
  if (typeof input.enabled !== 'boolean') throw new Error('Workroom A2A enabled must be boolean');
  if (input.expiresAt !== undefined && !Number.isFinite(input.expiresAt)) {
    throw new Error('Workroom A2A expiresAt must be finite');
  }
}

function resolveCredential(
  reference: WorkroomA2aCredentialReference,
  provider: WorkroomA2aSecureCredentialProvider | undefined,
): string {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw new Error('Workroom A2A credential reference must be an object');
  }
  if (reference.source === 'config') {
    assertExactKeys(reference, ['source', 'value'], 'config credential');
    return credential(reference.value);
  }
  if (reference.source === 'secure_provider') {
    assertExactKeys(reference, ['source', 'secretRef'], 'secure credential');
    text(reference.secretRef, 'credential secretRef');
    if (!provider) throw new Error('Workroom A2A secure credential provider is required');
    return credential(provider.resolve(reference.secretRef));
  }
  throw new Error('Workroom A2A credential source is unsupported');
}

function credential(value: unknown): string {
  text(value, 'credential value');
  const result = value;
  if (result.length > 8_192 || /\s/u.test(result)) {
    throw new Error('Workroom A2A credential must be a bounded token without whitespace');
  }
  return result;
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function digestString(value: string): string {
  return `sha256:${hash(value).toString('hex')}`;
}

function assertExactKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`Workroom A2A ${label} contains forbidden field ${unexpected}`);
}

function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Workroom A2A ${label} must be non-empty text`);
  }
}

function positiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Workroom A2A ${label} must be a positive safe integer`);
  }
}

function canonicalDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Workroom A2A ${label} must be a canonical sha256 digest`);
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}
