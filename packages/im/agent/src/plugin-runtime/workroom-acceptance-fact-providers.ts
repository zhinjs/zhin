import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createToken } from '@zhin.js/plugin-runtime';
import type { WorkroomContextReleaseRequest } from './workroom-accepted-source-runtime.js';
import {
  createWorkroomGovernedAcceptanceProjection,
  createWorkroomKernelRiskHeader,
  type WorkroomGovernedAcceptanceProjection,
  type WorkroomGovernedAcceptanceProjectionPort,
  type WorkroomKernelRiskHeader,
  type WorkroomKernelRiskHeaderPort,
  type WorkroomTypedAcceptanceCheck,
  type WorkroomContextReleaseConsumerPort,
} from './workroom-acceptance-provider-composition.js';
import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import { DurableFileStore } from '../workroom/durable-file-store.js';

export interface WorkroomAcceptanceProjectionSource {
  readonly kind: 'profile-policy';
  readonly ref: string;
  readonly digest: string;
  readonly issuer: string;
  readonly issuerDigest: string;
  readonly revision: number;
}

export interface WorkroomAcceptanceProjectionCandidate {
  readonly projection: WorkroomGovernedAcceptanceProjection;
  readonly source: WorkroomAcceptanceProjectionSource;
}

export interface WorkroomAcceptanceProjectionPayloadReceipt {
  readonly vaultObjectId: string;
  readonly objectId: string;
  readonly payloadHash: string;
  readonly descriptorDigest: string;
  readonly locationManifestDigest: string;
  readonly source: Readonly<{
    kind: 'profile-policy';
    ref: string;
    digest: string;
    issuer: string;
    issuerDigest: string;
    revision: number;
    bindingDigest: string;
    verification: 'verified';
  }>;
  readonly sourceBindingDigest: string;
  readonly bytes: number;
}

export interface WorkroomAcceptanceProjectionPayloadPort {
  write(input: Readonly<{
    operationId: string;
    projectId: string;
    projection: WorkroomGovernedAcceptanceProjection;
    source: WorkroomAcceptanceProjectionSource & Readonly<{ bindingDigest: string }>;
  }>, signal: AbortSignal): Promise<WorkroomAcceptanceProjectionPayloadReceipt>;
  read(input: Readonly<{
    operationId: string;
    projectId: string;
    purpose: 'acceptance-policy';
    receipt: WorkroomAcceptanceProjectionPayloadReceipt;
  }>, signal: AbortSignal): Promise<WorkroomGovernedAcceptanceProjection | undefined>;
}

export const workroomAcceptanceProjectionPayloadToken =
  createToken<WorkroomAcceptanceProjectionPayloadPort>(
    'zhin.agent.workroom-acceptance-projection-payload',
    'Governed exact Profile-policy Acceptance projection payload writer and reauthorizing reader',
  );

export interface WorkroomAcceptanceProjectionSourcePort {
  list(projectId: string): Promise<readonly WorkroomAcceptanceProjectionCandidate[]>;
}

export interface WorkroomAcceptanceProjectionAuthorityPort {
  authorize(candidate: WorkroomAcceptanceProjectionCandidate): Promise<boolean>;
}

export function workroomAcceptanceProjectionSourceBindingDigest(
  candidate: WorkroomAcceptanceProjectionCandidate,
): string {
  const projection = createWorkroomGovernedAcceptanceProjection(candidate.projection);
  const source = normalizeProjectionSource(candidate.source);
  return digest({
    version: 1,
    projectId: projection.projectId,
    profileRevisionId: projection.profileRevisionId,
    profileDigest: projection.profileDigest,
    projectionDigest: projection.digest,
    source,
  });
}

interface WorkroomAcceptanceProjectionHeader {
  readonly version: 1;
  readonly projectId: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly projectionRevision: number;
  readonly projectionDigest: string;
  readonly issuer: string;
  readonly source: WorkroomAcceptanceProjectionSource;
  readonly payload: WorkroomAcceptanceProjectionPayloadReceipt;
  readonly digest: string;
}

/** Header-only repository. Policy payload is governed and reauthorized on every resolve. */
export class FileWorkroomAcceptanceProjectionRepository
implements WorkroomGovernedAcceptanceProjectionPort {
  readonly #store: DurableFileStore;
  readonly #signal: AbortSignal;

  constructor(readonly options: Readonly<{
    directory: string;
    payloads: WorkroomAcceptanceProjectionPayloadPort;
    authority: WorkroomAcceptanceProjectionAuthorityPort;
    signal?: AbortSignal;
  }>) {
    this.#store = new DurableFileStore(options.directory);
    this.#signal = options.signal ?? new AbortController().signal;
  }

  async publish(candidate: WorkroomAcceptanceProjectionCandidate): Promise<'created' | 'replayed'> {
    this.#signal.throwIfAborted();
    const projection = createWorkroomGovernedAcceptanceProjection(candidate.projection);
    if (projection.digest !== candidate.projection.digest) throw new Error('Acceptance projection digest drift');
    const source = normalizeProjectionSource(candidate.source);
    if (!await this.options.authority.authorize({ projection, source })) {
      throw new Error('Acceptance projection source is not authorized');
    }
    if (source.revision !== projection.revision || source.issuer !== projection.issuer) {
      throw new Error('Acceptance projection source authority drift');
    }
    const bindingDigest = workroomAcceptanceProjectionSourceBindingDigest({ projection, source });
    const payload = validateProjectionPayloadReceipt(await this.options.payloads.write({
      operationId: `acceptance-projection:${projection.digest}`,
      projectId: projection.projectId,
      projection,
      source: { ...source, bindingDigest },
    }, this.#signal), projection, source, bindingDigest);
    const body = deepFreeze({
      version: 1 as const,
      projectId: projection.projectId,
      profileRevisionId: projection.profileRevisionId,
      profileDigest: projection.profileDigest,
      projectionRevision: projection.revision,
      projectionDigest: projection.digest,
      issuer: projection.issuer,
      source,
      payload,
    });
    const header = deepFreeze({ ...body, digest: digest(body) });
    await this.#store.ensureDurableLeaf('Workroom Acceptance projection repository');
    const target = this.#target(projection.projectId, projection.profileRevisionId, projection.profileDigest);
    const publication = await this.#store.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(header),
      createdValue: header,
      onConflict: async () => {
        const existing = parseProjectionHeader(JSON.parse(await readFile(target, 'utf8')));
        if (canonicalWorkroomJson(existing) !== canonicalWorkroomJson(header)) {
          throw new Error('Acceptance projection immutable slot conflict');
        }
        return existing;
      },
    });
    return publication.status;
  }

  async resolve(input: Parameters<WorkroomGovernedAcceptanceProjectionPort['resolve']>[0]) {
    this.#signal.throwIfAborted();
    let header: WorkroomAcceptanceProjectionHeader;
    try {
      header = parseProjectionHeader(JSON.parse(await readFile(
        this.#target(input.projectId, input.profileRevisionId, input.profileDigest), 'utf8',
      )));
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
    if (header.projectId !== input.projectId || header.profileRevisionId !== input.profileRevisionId
      || header.profileDigest !== input.profileDigest) {
      throw new Error('Acceptance projection header lookup drift');
    }
    const projection = await this.options.payloads.read({
      operationId: `acceptance-projection-read:${header.projectionDigest}`,
      projectId: header.projectId,
      purpose: 'acceptance-policy',
      receipt: header.payload,
    }, this.#signal);
    if (!projection) return null;
    const canonical = createWorkroomGovernedAcceptanceProjection(projection);
    if (canonical.digest !== header.projectionDigest || canonical.projectId !== header.projectId
      || canonical.profileRevisionId !== header.profileRevisionId
      || canonical.profileDigest !== header.profileDigest || canonical.revision !== header.projectionRevision
      || canonical.issuer !== header.issuer) {
      throw new Error('Governed Acceptance projection payload/header binding drift');
    }
    if (!await this.options.authority.authorize({ projection: canonical, source: header.source })) {
      throw new Error('Persisted Acceptance projection source is no longer authorized');
    }
    return canonical;
  }

  #target(projectId: string, revisionId: string, profileDigest: string): string {
    return join(this.options.directory, `${key(`${projectId}:${revisionId}:${profileDigest}`)}.json`);
  }
}

/** Trusted Profile-policy source -> governed projection header publisher. */
export class WorkroomAcceptanceProjectionWorker {
  constructor(readonly options: Readonly<{
    repository: FileWorkroomAcceptanceProjectionRepository;
    source: WorkroomAcceptanceProjectionSourcePort;
    authority: WorkroomAcceptanceProjectionAuthorityPort;
    signal: AbortSignal;
  }>) {}

  async drain(projectIds: readonly string[]): Promise<number> {
    let created = 0;
    for (const projectId of unique(projectIds, 'Acceptance projection Project ids').sort()) {
      this.options.signal.throwIfAborted();
      const candidates = await this.options.source.list(required(projectId, 'Acceptance projection Project id'));
      for (const candidate of candidates) {
        if (candidate.projection.projectId !== projectId) throw new Error('Acceptance projection source Project drift');
        if (!await this.options.authority.authorize(candidate)) {
          throw new Error('Acceptance projection source is not authorized');
        }
        if (await this.options.repository.publish(candidate) === 'created') created += 1;
      }
    }
    return created;
  }
}

export type WorkroomRiskHeaderProducerKind =
  | 'kernel-plan'
  | 'kernel-capability'
  | 'workspace-artifact'
  | 'effect-ledger';

export interface WorkroomRiskHeaderProducerProof {
  readonly generation: number;
  readonly kind: WorkroomRiskHeaderProducerKind;
  readonly issuer: string;
  readonly issuerDigest: string;
  readonly factRef: string;
  readonly factDigest: string;
  /** Exact trusted fact used to authorize derived headers; never contains payload content. */
  readonly authorityRef?: string;
  readonly authorityDigest?: string;
}

export interface WorkroomRiskHeaderPublication {
  readonly producer: WorkroomRiskHeaderProducerProof;
  readonly header: WorkroomKernelRiskHeader;
}

export interface WorkroomRiskHeaderProducerAuthorityPort {
  authorize(publication: WorkroomRiskHeaderPublication): Promise<boolean>;
}

interface StoredRiskHeader extends WorkroomKernelRiskHeader {
  readonly producer: WorkroomRiskHeaderProducerProof;
  readonly recordDigest: string;
}

/** Immutable header repository. It has no draft/model ingress and requires generation authority. */
export class FileWorkroomKernelRiskHeaderRepository implements WorkroomKernelRiskHeaderPort {
  readonly #store: DurableFileStore;

  constructor(readonly options: Readonly<{
    directory: string;
    generation: number;
    authority: WorkroomRiskHeaderProducerAuthorityPort;
  }>) {
    positive(options.generation, 'Risk Header generation');
    this.#store = new DurableFileStore(options.directory);
  }

  async publish(publication: WorkroomRiskHeaderPublication): Promise<'created' | 'replayed'> {
    const header = createWorkroomKernelRiskHeader(publication.header);
    const producer = normalizeProducer(publication.producer);
    if (producer.generation !== this.options.generation) throw new Error('Risk Header producer generation drift');
    if (producer.kind !== producerKindFor(header.sourceType)
      || producer.factRef !== header.sourceRef || producer.factDigest !== header.sourceContentDigest
      || producer.issuer !== header.issuer) {
      throw new Error('Risk Header producer fact binding drift');
    }
    if (!await this.options.authority.authorize({ producer, header })) {
      throw new Error('Risk Header producer is not authorized');
    }
    const body = deepFreeze({ ...header, producer });
    const record = deepFreeze({ ...body, recordDigest: digest(body) });
    await this.#store.ensureDurableLeaf('Workroom Kernel Risk Header repository');
    const target = join(this.options.directory, `${key(`${scopeKey(header)}:${header.sourceType}:${header.sourceRef}`)}.json`);
    const result = await this.#store.publishCreateOnly({
      target, content: canonicalWorkroomJson(record), createdValue: record,
      onConflict: async () => {
        const existing = parseRiskRecord(JSON.parse(await readFile(target, 'utf8')));
        if (canonicalWorkroomJson(existing) !== canonicalWorkroomJson(record)) {
          throw new Error('Kernel Risk Header immutable slot conflict');
        }
        return existing;
      },
    });
    return result.status;
  }

  async resolve(input: Parameters<WorkroomKernelRiskHeaderPort['resolve']>[0]) {
    let names: string[];
    try {
      names = await readdir(this.options.directory);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return Object.freeze([]);
      throw error;
    }
    const records = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name =>
      parseRiskRecord(JSON.parse(await readFile(join(this.options.directory, name), 'utf8')))));
    const requestedArtifacts = new Set(input.artifactRefs);
    const selected = records.filter(record => record.scope.projectId === input.projectId
      && record.scope.runId === input.runId && record.scope.taskKey === input.taskKey
      && record.scope.taskRevision === input.taskRevision && record.scope.candidateHash === input.candidateHash
      && record.policyRevision === input.policyRevision
      && (record.sourceType === 'workflow-plan'
        ? record.sourceRef === input.planRef && record.sourceRevision === input.planRevision
        : record.sourceType === 'artifact-header' ? requestedArtifacts.has(record.sourceRef) : true))
      .sort(compareRiskRecord);
    for (const record of selected) await this.#assertAuthorized(record.producer, record);
    return Object.freeze(selected.map(record => {
        const { producer: _producer, recordDigest: _recordDigest, ...header } = record;
        return deepFreeze(header);
      }));
  }

  async #assertAuthorized(
    producer: WorkroomRiskHeaderProducerProof,
    value: WorkroomKernelRiskHeader,
  ): Promise<void> {
    const header = createWorkroomKernelRiskHeader(value);
    if (producer.generation !== this.options.generation
      || producer.kind !== producerKindFor(header.sourceType)
      || producer.factRef !== header.sourceRef || producer.factDigest !== header.sourceContentDigest
      || producer.issuer !== header.issuer
      || !await this.options.authority.authorize({ producer, header })) {
      throw new Error('Persisted Kernel Risk Header producer authority drift');
    }
  }
}

/** Generation composition freezes this registry; empty intentionally means provider unavailable. */
export class ImmutableWorkroomTypedCheckRegistry {
  readonly #checks: readonly WorkroomTypedAcceptanceCheck[];
  readonly available: boolean;

  constructor(checks: readonly WorkroomTypedAcceptanceCheck[]) {
    const ids = checks.map(check => required(check.id, 'Typed Check id'));
    if (new Set(ids).size !== ids.length) throw new Error('Typed Check registry contains duplicate ids');
    this.#checks = Object.freeze([...checks]);
    this.available = this.#checks.length > 0;
  }

  list(): readonly WorkroomTypedAcceptanceCheck[] {
    return this.#checks;
  }
}

export interface WorkroomEphemeralContextProviderIdentity {
  readonly kind: 'local' | 'remote';
  readonly id: string;
  readonly digest: string;
}

export interface WorkroomEphemeralContextProviderReceipt {
  readonly version: 1;
  readonly operationId: string;
  readonly eligibilityDigest: string;
  readonly provider: WorkroomEphemeralContextProviderIdentity;
  readonly status: 'released' | 'outcome_unknown';
  readonly receiptRef: string;
  readonly authenticatedBy: string;
  readonly digest: string;
}

export interface WorkroomEphemeralContextProviderPort {
  readonly identity: WorkroomEphemeralContextProviderIdentity;
  release(request: WorkroomContextReleaseRequest, signal: AbortSignal): Promise<WorkroomEphemeralContextProviderReceipt>;
  reconcile(request: WorkroomContextReleaseRequest, signal: AbortSignal): Promise<WorkroomEphemeralContextProviderReceipt>;
}

export interface WorkroomEphemeralContextRouteFact {
  readonly kind: 'local' | 'remote';
  readonly ref: string;
  readonly digest: string;
}

export interface WorkroomEphemeralContextRoutePort {
  resolve(
    eligibility: WorkroomContextReleaseRequest['eligibility'],
  ): Promise<WorkroomEphemeralContextRouteFact | undefined>;
}

export interface WorkroomEphemeralContextReleaseCapabilityPort {
  release(input: Readonly<{
    request: WorkroomContextReleaseRequest;
    route: WorkroomEphemeralContextRouteFact;
  }>, signal: AbortSignal): Promise<Readonly<{
    status: 'released' | 'outcome_unknown';
    receiptRef: string;
    authenticatedBy: string;
  }>>;
  reconcile(input: Readonly<{
    request: WorkroomContextReleaseRequest;
    route: WorkroomEphemeralContextRouteFact;
  }>, signal: AbortSignal): Promise<Readonly<{
    status: 'released' | 'outcome_unknown';
    receiptRef: string;
    authenticatedBy: string;
  }>>;
}

/**
 * Routes an exact accepted Task to its Kernel-observed local/remote provider.
 * The non-owning provider emits an authenticated no-op; a missing owning
 * capability remains outcome_unknown and therefore cannot release Context.
 */
export function createRoutedWorkroomEphemeralContextProvider(options: Readonly<{
  identity: WorkroomEphemeralContextProviderIdentity;
  routes: WorkroomEphemeralContextRoutePort;
  capability?: WorkroomEphemeralContextReleaseCapabilityPort;
}>): WorkroomEphemeralContextProviderPort {
  const identity = normalizeProviderIdentity(options.identity);
  const invoke = async (
    method: 'release' | 'reconcile',
    request: WorkroomContextReleaseRequest,
    signal: AbortSignal,
  ): Promise<WorkroomEphemeralContextProviderReceipt> => {
    signal.throwIfAborted();
    const route = await options.routes.resolve(request.eligibility);
    if (!route) {
      return createWorkroomEphemeralContextProviderReceipt({
        operationId: request.operationId, eligibility: request.eligibility, provider: identity,
        status: 'outcome_unknown',
        receiptRef: `context-route-unavailable:${identity.kind}:${digest(request.eligibility)}`,
        authenticatedBy: `context-route-authority:${identity.digest}`,
      });
    }
    const canonicalRoute = normalizeRouteFact(route);
    if (canonicalRoute.kind !== identity.kind) {
      return createWorkroomEphemeralContextProviderReceipt({
        operationId: request.operationId, eligibility: request.eligibility, provider: identity,
        status: 'released',
        receiptRef: `context-route-not-owned:${identity.kind}:${canonicalRoute.digest}`,
        authenticatedBy: `context-route-authority:${identity.digest}`,
      });
    }
    if (!options.capability) {
      return createWorkroomEphemeralContextProviderReceipt({
        operationId: request.operationId, eligibility: request.eligibility, provider: identity,
        status: 'outcome_unknown',
        receiptRef: `context-provider-unavailable:${identity.kind}:${canonicalRoute.digest}`,
        authenticatedBy: `context-route-authority:${identity.digest}`,
      });
    }
    const observed = await options.capability[method]({ request, route: canonicalRoute }, signal);
    return createWorkroomEphemeralContextProviderReceipt({
      operationId: request.operationId, eligibility: request.eligibility, provider: identity,
      status: observed.status, receiptRef: observed.receiptRef,
      authenticatedBy: observed.authenticatedBy,
    });
  };
  return Object.freeze({
    identity,
    release: (
      request: WorkroomContextReleaseRequest,
      signal: AbortSignal,
    ) => invoke('release', request, signal),
    reconcile: (
      request: WorkroomContextReleaseRequest,
      signal: AbortSignal,
    ) => invoke('reconcile', request, signal),
  });
}

export function createWorkroomEphemeralContextProviderReceipt(input: Readonly<{
  operationId: string;
  eligibility: WorkroomContextReleaseRequest['eligibility'];
  provider: WorkroomEphemeralContextProviderIdentity;
  status: 'released' | 'outcome_unknown';
  receiptRef: string;
  authenticatedBy: string;
}>): WorkroomEphemeralContextProviderReceipt {
  const body = deepFreeze({
    version: 1 as const,
    operationId: required(input.operationId, 'Context provider operation id'),
    eligibilityDigest: digest(input.eligibility),
    provider: normalizeProviderIdentity(input.provider),
    status: enumValue(input.status, ['released', 'outcome_unknown'], 'Context provider status'),
    receiptRef: required(input.receiptRef, 'Context provider receipt ref'),
    authenticatedBy: required(input.authenticatedBy, 'Context provider authenticatedBy'),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

/** Durable local/remote context release saga. Unknown receipts are reconciled, never treated as deleted. */
export class FileWorkroomEphemeralContextDisposer implements WorkroomContextReleaseConsumerPort {
  readonly #store: DurableFileStore;
  readonly #providers: readonly WorkroomEphemeralContextProviderPort[];

  constructor(readonly options: Readonly<{
    directory: string;
    providers: readonly WorkroomEphemeralContextProviderPort[];
    signal: AbortSignal;
  }>) {
    const identities = options.providers.map(provider => canonicalWorkroomJson(normalizeProviderIdentity(provider.identity)));
    if (new Set(identities).size !== identities.length) throw new Error('Context provider identity is duplicated');
    this.#providers = Object.freeze([...options.providers].sort((left, right) =>
      compareCanonicalWorkroomText(canonicalWorkroomJson(left.identity), canonicalWorkroomJson(right.identity))));
    this.#store = new DurableFileStore(options.directory);
  }

  async release(request: WorkroomContextReleaseRequest) {
    this.options.signal.throwIfAborted();
    const canonicalRequest = normalizeContextRequest(request);
    await this.#store.ensureDurableLeaf('Workroom Ephemeral Context disposer');
    const operationKey = key(canonicalRequest.operationId);
    const intentTarget = join(this.options.directory, `${operationKey}.intent.json`);
    await this.#store.publishCreateOnly({
      target: intentTarget, content: canonicalWorkroomJson(canonicalRequest), createdValue: canonicalRequest,
      onConflict: async () => {
        const existing = JSON.parse(await readFile(intentTarget, 'utf8')) as unknown;
        if (canonicalWorkroomJson(existing) !== canonicalWorkroomJson(canonicalRequest)) {
          throw new Error('Ephemeral Context release operation identity drift');
        }
        return canonicalRequest;
      },
    });
    const receipts: WorkroomEphemeralContextProviderReceipt[] = [];
    for (const provider of this.#providers) {
      this.options.signal.throwIfAborted();
      const providerKey = key(canonicalWorkroomJson(provider.identity));
      const releasedTarget = join(this.options.directory, `${operationKey}.${providerKey}.released.json`);
      const released = await readOptionalProviderReceipt(releasedTarget);
      if (released) {
        receipts.push(validateProviderReceipt(released, canonicalRequest, provider.identity));
        continue;
      }
      const hasUnknown = (await readdir(this.options.directory))
        .some(name => name.startsWith(`${operationKey}.${providerKey}.unknown.`));
      const observed = validateProviderReceipt(await (hasUnknown
        ? provider.reconcile(canonicalRequest, this.options.signal)
        : provider.release(canonicalRequest, this.options.signal)), canonicalRequest, provider.identity);
      receipts.push(observed);
      const target = observed.status === 'released'
        ? releasedTarget
        : join(this.options.directory, `${operationKey}.${providerKey}.unknown.${key(observed.digest)}.json`);
      await this.#store.publishCreateOnly({
        target, content: canonicalWorkroomJson(observed), createdValue: observed,
        onConflict: async () => validateProviderReceipt(
          JSON.parse(await readFile(target, 'utf8')), canonicalRequest, provider.identity,
        ),
      });
    }
    const released = this.#providers.length > 0 && receipts.every(receipt => receipt.status === 'released');
    return deepFreeze({
      status: released ? 'released' as const : 'outcome_unknown' as const,
      receiptRef: `context-disposer:${digest({ operationId: request.operationId,
        receipts: receipts.map(receipt => receipt.digest) })}`,
    });
  }
}

function validateProjectionPayloadReceipt(
  receipt: WorkroomAcceptanceProjectionPayloadReceipt,
  projection: WorkroomGovernedAcceptanceProjection,
  source: WorkroomAcceptanceProjectionSource,
  bindingDigest: string,
): WorkroomAcceptanceProjectionPayloadReceipt {
  for (const [label, value] of [
    ['vaultObjectId', receipt.vaultObjectId], ['objectId', receipt.objectId],
  ] as const) required(value, `Acceptance projection payload ${label}`);
  for (const [label, value] of [
    ['payloadHash', receipt.payloadHash], ['descriptorDigest', receipt.descriptorDigest],
    ['locationManifestDigest', receipt.locationManifestDigest],
    ['sourceBindingDigest', receipt.sourceBindingDigest],
  ] as const) requiredDigest(value, `Acceptance projection payload ${label}`);
  if (receipt.payloadHash !== projection.digest || receipt.source.kind !== 'profile-policy'
    || receipt.source.ref !== source.ref || receipt.source.digest !== source.digest
    || receipt.source.issuer !== source.issuer || receipt.source.issuerDigest !== source.issuerDigest
    || receipt.source.revision !== source.revision
    || receipt.source.bindingDigest !== bindingDigest || receipt.sourceBindingDigest !== bindingDigest
    || receipt.source.verification !== 'verified' || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1) {
    throw new Error('Acceptance projection governed payload receipt binding drift');
  }
  return deepFreeze(structuredClone(receipt));
}

function normalizeProjectionSource(source: WorkroomAcceptanceProjectionSource): WorkroomAcceptanceProjectionSource {
  if (source.kind !== 'profile-policy') throw new Error('Acceptance projection source kind is invalid');
  return deepFreeze({
    kind: source.kind,
    ref: required(source.ref, 'Acceptance projection source ref'),
    digest: requiredDigest(source.digest, 'Acceptance projection source digest'),
    issuer: required(source.issuer, 'Acceptance projection source issuer'),
    issuerDigest: requiredDigest(source.issuerDigest, 'Acceptance projection source issuer digest'),
    revision: positive(source.revision, 'Acceptance projection source revision'),
  });
}

function parseProjectionHeader(value: unknown): WorkroomAcceptanceProjectionHeader {
  const header = value as WorkroomAcceptanceProjectionHeader;
  if (!header || header.version !== 1 || digest({
    version: header.version, projectId: header.projectId, profileRevisionId: header.profileRevisionId,
    profileDigest: header.profileDigest, projectionRevision: header.projectionRevision,
    projectionDigest: header.projectionDigest, issuer: header.issuer, source: header.source, payload: header.payload,
  }) !== header.digest) throw new Error('Acceptance projection header is malformed');
  return deepFreeze(structuredClone(header));
}

function normalizeProducer(producer: WorkroomRiskHeaderProducerProof): WorkroomRiskHeaderProducerProof {
  return deepFreeze({
    generation: positive(producer.generation, 'Risk Header producer generation'),
    kind: enumValue(producer.kind, ['kernel-plan', 'kernel-capability', 'workspace-artifact', 'effect-ledger'],
      'Risk Header producer kind'),
    issuer: required(producer.issuer, 'Risk Header producer issuer'),
    issuerDigest: requiredDigest(producer.issuerDigest, 'Risk Header producer issuer digest'),
    factRef: required(producer.factRef, 'Risk Header producer fact ref'),
    factDigest: requiredDigest(producer.factDigest, 'Risk Header producer fact digest'),
    ...(producer.authorityRef === undefined && producer.authorityDigest === undefined
      ? {}
      : {
          authorityRef: required(producer.authorityRef, 'Risk Header producer authority ref'),
          authorityDigest: requiredDigest(
            producer.authorityDigest,
            'Risk Header producer authority digest',
          ),
        }),
  });
}

function producerKindFor(sourceType: WorkroomKernelRiskHeader['sourceType']): WorkroomRiskHeaderProducerKind {
  if (sourceType === 'workflow-plan') return 'kernel-plan';
  if (sourceType === 'capability-snapshot') return 'kernel-capability';
  if (sourceType === 'artifact-header') return 'workspace-artifact';
  return 'effect-ledger';
}

function scopeKey(header: WorkroomKernelRiskHeader): string {
  return canonicalWorkroomJson(header.scope);
}

function parseRiskRecord(value: unknown): StoredRiskHeader {
  const record = value as StoredRiskHeader;
  if (!record?.producer || record.recordDigest !== digest((({ recordDigest: _digest, ...body }) => body)(record))) {
    throw new Error('Kernel Risk Header record is malformed');
  }
  const { producer: _producer, recordDigest: _recordDigest, ...header } = record;
  const canonical = createWorkroomKernelRiskHeader(header);
  if (canonical.digest !== record.digest) throw new Error('Kernel Risk Header record digest drift');
  return deepFreeze(structuredClone(record));
}

function compareRiskRecord(left: StoredRiskHeader, right: StoredRiskHeader): number {
  return compareCanonicalWorkroomText(left.sourceType, right.sourceType) || compareCanonicalWorkroomText(left.sourceRef, right.sourceRef);
}

function normalizeProviderIdentity(identity: WorkroomEphemeralContextProviderIdentity) {
  return deepFreeze({
    kind: enumValue(identity.kind, ['local', 'remote'], 'Context provider kind'),
    id: required(identity.id, 'Context provider id'),
    digest: requiredDigest(identity.digest, 'Context provider digest'),
  });
}

function normalizeRouteFact(route: WorkroomEphemeralContextRouteFact): WorkroomEphemeralContextRouteFact {
  return deepFreeze({
    kind: enumValue(route.kind, ['local', 'remote'], 'Context route kind'),
    ref: required(route.ref, 'Context route ref'),
    digest: requiredDigest(route.digest, 'Context route digest'),
  });
}

function normalizeContextRequest(request: WorkroomContextReleaseRequest): WorkroomContextReleaseRequest {
  required(request.operationId, 'Context release operation id');
  if (!request.eligibility?.eligible) throw new Error('Context release eligibility is invalid');
  return deepFreeze(structuredClone(request));
}

function validateProviderReceipt(
  value: unknown,
  request: WorkroomContextReleaseRequest,
  identity: WorkroomEphemeralContextProviderIdentity,
): WorkroomEphemeralContextProviderReceipt {
  const receipt = value as WorkroomEphemeralContextProviderReceipt;
  const canonical = createWorkroomEphemeralContextProviderReceipt({
    operationId: receipt?.operationId,
    eligibility: request.eligibility,
    provider: receipt?.provider,
    status: receipt?.status,
    receiptRef: receipt?.receiptRef,
    authenticatedBy: receipt?.authenticatedBy,
  });
  if (canonical.digest !== receipt.digest || canonical.operationId !== request.operationId
    || canonical.eligibilityDigest !== digest(request.eligibility)
    || canonicalWorkroomJson(canonical.provider) !== canonicalWorkroomJson(normalizeProviderIdentity(identity))) {
    throw new Error('Ephemeral Context provider receipt authority drift');
  }
  return canonical;
}

async function readOptionalProviderReceipt(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

function key(value: string): string {
  return digest(value).slice('sha256:'.length);
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required`);
  return value;
}

function requiredDigest(value: string | undefined, label: string): string {
  if (!value || !/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid`);
  return value;
}

function enumValue<T extends string>(value: T, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value)) throw new Error(`${label} is invalid`);
  return value;
}

function unique(values: readonly string[], label: string): string[] {
  const normalized = values.map(value => required(value, label));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} contains duplicates`);
  return normalized;
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
