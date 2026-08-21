import type { PayloadVaultObjectHandle } from './disclosure-manifest.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';

export type PayloadLifecycleRole = 'data_steward' | 'privacy' | 'compliance';
export type PayloadLocationKind = 'vault_primary' | 'index' | 'cache' | 'replica' | 'backup' | 'processor';
export type PayloadLocationDeletionMode = 'crypto_erase' | 'delete' | 'processor_recall';

export function digestPayloadSubjectRef(tenantId: string, subjectRef: string): string {
  text(tenantId, 'Payload subject tenantId');
  text(subjectRef, 'Payload subject ref');
  return digest({ version: 1, tenantId, subjectRef });
}

export interface PayloadLocationAuthority {
  readonly id: string;
  readonly kind: PayloadLocationKind;
  readonly authorityDigest: string;
  readonly deletionMode: PayloadLocationDeletionMode;
}

export interface PayloadLocationManifest {
  readonly version: 1;
  readonly tenantId: string;
  readonly projectId: string;
  readonly objectId: string;
  readonly vaultObjectId: string;
  readonly descriptorDigest: string;
  readonly revision: number;
  readonly locations: readonly PayloadLocationAuthority[];
  readonly digest: string;
}

export function createPayloadLocationManifest(
  input: Omit<PayloadLocationManifest, 'digest'>,
): PayloadLocationManifest {
  if (input.version !== 1) throw new Error('Payload Location Manifest version is invalid');
  text(input.tenantId, 'Location Manifest tenantId');
  text(input.projectId, 'Location Manifest projectId');
  text(input.objectId, 'Location Manifest objectId');
  text(input.vaultObjectId, 'Location Manifest vaultObjectId');
  requiredDigest(input.descriptorDigest, 'Location Manifest Descriptor digest');
  positive(input.revision, 'Location Manifest revision');
  if (!Array.isArray(input.locations) || input.locations.length === 0) {
    throw new Error('Payload Location Manifest must contain at least one location');
  }
  const locations = input.locations.map(location => {
    text(location.id, 'Payload location id');
    if (!['vault_primary', 'index', 'cache', 'replica', 'backup', 'processor'].includes(location.kind)) {
      throw new Error('Payload location kind is invalid');
    }
    if (!['crypto_erase', 'delete', 'processor_recall'].includes(location.deletionMode)) {
      throw new Error('Payload location deletion mode is invalid');
    }
    requiredDigest(location.authorityDigest, 'Payload location authority digest');
    return deepFreeze(structuredClone(location));
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(locations.map(location => location.id)).size !== locations.length) {
    throw new Error('Payload Location Manifest contains duplicate locations');
  }
  if (locations.filter(location => location.deletionMode === 'crypto_erase').length > 1) {
    throw new Error('Payload Location Manifest has multiple object-key authorities');
  }
  const body = deepFreeze({
    version: 1 as const,
    tenantId: input.tenantId,
    projectId: input.projectId,
    objectId: input.objectId,
    vaultObjectId: input.vaultObjectId,
    descriptorDigest: input.descriptorDigest,
    revision: input.revision,
    locations,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface PayloadLifecycleObjectAuthority {
  readonly version: 1;
  readonly handle: PayloadVaultObjectHandle;
  readonly retention: Readonly<{
    readonly class: 'transient' | 'operational' | 'project_record' | 'regulated_record';
    readonly minimumRetainUntil: number;
    readonly deleteAfter: number;
  }>;
  /** Digests only. Raw subject identifiers never enter the lifecycle Journal. */
  readonly subjectDigests: readonly string[];
  readonly locations: PayloadLocationManifest;
  readonly digest: string;
}

export function createPayloadLifecycleObjectAuthority(
  input: Omit<PayloadLifecycleObjectAuthority, 'digest'>,
): PayloadLifecycleObjectAuthority {
  if (input.version !== 1) throw new Error('Payload Lifecycle object authority version is invalid');
  assertHandle(input.handle);
  const manifest = createPayloadLocationManifest(input.locations);
  if (canonicalWorkroomJson(manifest) !== canonicalWorkroomJson(input.locations)
    || manifest.tenantId !== input.handle.tenantId
    || manifest.projectId !== input.handle.projectId
    || manifest.objectId !== input.handle.objectId
    || manifest.vaultObjectId !== input.handle.vaultObjectId
    || manifest.descriptorDigest !== input.handle.descriptorDigest
    || manifest.digest !== input.handle.locationManifestDigest) {
    throw new Error('Payload Lifecycle object/Location Manifest binding is invalid');
  }
  if (!input.retention || !['transient', 'operational', 'project_record', 'regulated_record']
    .includes(input.retention.class)
    || !Number.isSafeInteger(input.retention.minimumRetainUntil)
    || !Number.isSafeInteger(input.retention.deleteAfter)
    || input.retention.minimumRetainUntil < 0
    || input.retention.deleteAfter < input.retention.minimumRetainUntil) {
    throw new Error('Payload Lifecycle retention authority is invalid');
  }
  const subjectDigests = uniqueDigests(input.subjectDigests, 'Payload Lifecycle subject digest');
  const body = deepFreeze({
    version: 1 as const,
    handle: structuredClone(input.handle),
    retention: structuredClone(input.retention),
    subjectDigests,
    locations: manifest,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface PayloadLifecycleClockSnapshot {
  readonly version: 1;
  readonly now: number;
  readonly revision: number;
  readonly digest: string;
}

export function createPayloadLifecycleClockSnapshot(
  input: Omit<PayloadLifecycleClockSnapshot, 'digest'>,
): PayloadLifecycleClockSnapshot {
  if (input.version !== 1 || !Number.isSafeInteger(input.now) || input.now < 0
    || !Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new Error('Payload Lifecycle Kernel clock is invalid');
  }
  const body = deepFreeze({ version: 1 as const, now: input.now, revision: input.revision });
  return deepFreeze({ ...body, digest: digest(body) });
}

export type PayloadLifecycleAuthorityAction =
  | 'register_object'
  | 'place_hold'
  | 'review_hold'
  | 'release_hold'
  | 'request_subject_erasure'
  | 'schedule_retention_purge'
  | 'reconcile_purge';

export interface PayloadLifecycleAuthorityRequest {
  readonly version: 1;
  readonly action: PayloadLifecycleAuthorityAction;
  readonly requiredRole: PayloadLifecycleRole;
  readonly operationId: string;
  readonly authenticatedPrincipalId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly objectId: string;
  readonly objectAuthorityDigest: string;
  readonly currentStateDigest: string;
  readonly candidateDigest: string;
  readonly clock: PayloadLifecycleClockSnapshot;
  readonly digest: string;
}

export interface PayloadLifecycleAuthorityDecision {
  readonly approved: true;
  readonly requestDigest: string;
  readonly decisionId: string;
  readonly principalId: string;
  readonly role: PayloadLifecycleRole;
  readonly authorityDigest: string;
  readonly decidedAt: number;
  readonly minimumRetentionOverride?: Readonly<{
    readonly policyRef: string;
    readonly policyDigest: string;
    readonly objectAuthorityDigest: string;
  }>;
  readonly separationPolicy?: Readonly<{
    readonly allowsSelfReview: boolean;
    readonly policyDigest: string;
  }>;
}

export type PayloadLifecycleAuthorityResult = PayloadLifecycleAuthorityDecision
  | Readonly<{ approved: false; requestDigest: string; reason: string }>;

export interface PayloadLifecycleCommandAuthorityPort {
  authorize(request: PayloadLifecycleAuthorityRequest): Promise<PayloadLifecycleAuthorityResult>;
  verify(request: PayloadLifecycleAuthorityRequest, decision: PayloadLifecycleAuthorityDecision): Promise<boolean>;
}

export interface PayloadLifecycleKernelClockPort {
  read(input: Readonly<{
    operationId: string;
    projectId: string;
    objectId: string;
    purpose: 'control' | 'retention' | 'reconciliation';
  }>): Promise<PayloadLifecycleClockSnapshot | undefined>;
}

export interface PayloadLifecycleObjectAuthorityPort {
  resolve(handle: PayloadVaultObjectHandle, signal: AbortSignal): Promise<PayloadLifecycleObjectAuthority | undefined>;
}

export interface PayloadSubjectErasureResolution {
  readonly version: 1;
  readonly tenantId: string;
  readonly projectId: string;
  readonly subjectDigest: string;
  readonly handles: readonly PayloadVaultObjectHandle[];
  readonly authorityDigest: string;
  readonly digest: string;
}

export interface PayloadSubjectErasureResolverPort {
  resolve(input: Readonly<{
    tenantId: string;
    projectId: string;
    subjectRef: string;
  }>, signal: AbortSignal): Promise<PayloadSubjectErasureResolution | undefined>;
}

export interface PayloadRetentionHold {
  readonly id: string;
  readonly ownerPrincipalId: string;
  readonly reasonCode: 'legal_hold' | 'investigation' | 'regulatory_preservation';
  readonly placedAt: number;
  readonly reviewAt: number;
  readonly placeRequest: PayloadLifecycleAuthorityRequest;
  readonly placeDecision: PayloadLifecycleAuthorityDecision;
  readonly review?: Readonly<{
    readonly approved: boolean;
    readonly reviewerPrincipalId: string;
    readonly reviewedAt: number;
    readonly request: PayloadLifecycleAuthorityRequest;
    readonly decision: PayloadLifecycleAuthorityDecision;
  }>;
  readonly release?: Readonly<{
    readonly releasedBy: string;
    readonly releasedAt: number;
    readonly request: PayloadLifecycleAuthorityRequest;
    readonly decision: PayloadLifecycleAuthorityDecision;
  }>;
}

export interface PayloadSubjectErasureFact {
  readonly subjectDigest: string;
  readonly requestedAt: number;
  readonly request: PayloadLifecycleAuthorityRequest;
  readonly decision: PayloadLifecycleAuthorityDecision;
  readonly resolverAuthorityDigest: string;
}

export interface PayloadLifecycleGovernanceProof {
  readonly request: PayloadLifecycleAuthorityRequest;
  readonly decision: PayloadLifecycleAuthorityDecision;
}

export interface PayloadPurgeDispatch {
  readonly id: string;
  readonly reason: 'retention_expired' | 'subject_erasure';
  readonly objectAuthorityDigest: string;
  readonly locationManifestDigest: string;
  readonly location: PayloadLocationAuthority;
  readonly attempt: number;
  readonly fence: number;
  readonly requestedAt: number;
  readonly requestDigest: string;
  readonly governance: PayloadLifecycleGovernanceProof;
  readonly digest: string;
}

export interface PayloadPurgeReceipt {
  readonly version: 1;
  readonly purgeId: string;
  readonly projectId: string;
  readonly objectId: string;
  readonly locationId: string;
  readonly locationAuthorityDigest: string;
  readonly locationManifestDigest: string;
  readonly attempt: number;
  readonly fence: number;
  readonly requestDigest: string;
  readonly status: 'confirmed' | 'failed' | 'outcome_unknown';
  readonly reasonCode?: 'unsupported' | 'provider_denied' | 'transient_failure' | 'timeout' | 'unknown_external_copy';
  readonly cryptoEraseReceiptDigest?: string;
  readonly authenticatedBy: string;
  readonly observedAt: number;
  readonly authorityDigest: string;
  readonly digest: string;
}

export interface PayloadPurgeReceiptAuthorityPort {
  /** Verify the persisted receipt proof itself, not current provider membership. */
  verify(receipt: PayloadPurgeReceipt, dispatch: PayloadPurgeDispatch): Promise<boolean>;
}

export interface PayloadLocationDeletionPort {
  /**
   * Execute or observe one idempotent attempt. Implementations MUST key the
   * external operation by purge id + attempt + fence and never duplicate it.
   */
  purge(dispatch: PayloadPurgeDispatch, signal: AbortSignal): Promise<PayloadPurgeReceipt>;
}

export interface PayloadCryptoEraseTombstone {
  readonly version: 1;
  readonly projectId: string;
  readonly objectId: string;
  readonly vaultObjectId: string;
  readonly objectAuthorityDigest: string;
  readonly locationManifestDigest: string;
  readonly locationId: string;
  readonly cryptoEraseReceiptDigest: string;
  readonly erasedAt: number;
  readonly digest: string;
}

export interface PayloadPurgeCompletion {
  readonly version: 1;
  readonly projectId: string;
  readonly objectId: string;
  readonly objectAuthorityDigest: string;
  readonly locationManifestDigest: string;
  readonly completedAt: number;
  readonly receiptDigests: readonly string[];
  readonly digest: string;
}

export type PayloadLifecycleEventDraft = Readonly<{
  type: 'object.registered';
  payload: Readonly<{
    authority: PayloadLifecycleObjectAuthority;
    governance: PayloadLifecycleGovernanceProof;
  }>;
}> | Readonly<{
  type: 'hold.placed';
  payload: PayloadRetentionHold;
}> | Readonly<{
  type: 'hold.reviewed' | 'hold.released';
  payload: Readonly<{ holdId: string; hold: PayloadRetentionHold }>;
}> | Readonly<{
  type: 'erasure.requested';
  payload: PayloadSubjectErasureFact;
}> | Readonly<{
  type: 'purge.requested';
  payload: PayloadPurgeDispatch;
}> | Readonly<{
  type: 'purge.receipt';
  payload: PayloadPurgeReceipt;
}> | Readonly<{
  type: 'object.crypto_erased';
  payload: PayloadCryptoEraseTombstone;
}> | Readonly<{
  type: 'object.purge_complete';
  payload: PayloadPurgeCompletion;
}>;

export type PayloadLifecycleEvent = PayloadLifecycleEventDraft & Readonly<{
  version: 1;
  projectId: string;
  objectId: string;
  sequence: number;
  digest: string;
}>;

export interface PayloadLifecycleJournal {
  read(projectId: string, objectId: string): Promise<readonly PayloadLifecycleEvent[]>;
  append(
    projectId: string,
    objectId: string,
    expectedSequence: number,
    drafts: readonly PayloadLifecycleEventDraft[],
  ): Promise<readonly PayloadLifecycleEvent[]>;
  listObjectIds(projectId: string): Promise<readonly string[]>;
}

export interface PayloadLifecycleState {
  readonly projectId: string;
  readonly objectId: string;
  readonly sequence: number;
  readonly digest: string;
  readonly authority?: PayloadLifecycleObjectAuthority;
  readonly holds: Readonly<Record<string, PayloadRetentionHold>>;
  readonly erasures: readonly PayloadSubjectErasureFact[];
  readonly purges: Readonly<Record<string, Readonly<{
    dispatch: PayloadPurgeDispatch;
    receipt?: PayloadPurgeReceipt;
  }>>>;
  readonly cryptoErased?: PayloadCryptoEraseTombstone;
  readonly purgeComplete?: PayloadPurgeCompletion;
}

export function replayPayloadLifecycle(
  projectId: string,
  objectId: string,
  events: readonly PayloadLifecycleEvent[],
): PayloadLifecycleState {
  text(projectId, 'Lifecycle Project id');
  text(objectId, 'Lifecycle object id');
  let authority: PayloadLifecycleObjectAuthority | undefined;
  const holds: Record<string, PayloadRetentionHold> = {};
  const erasures: PayloadSubjectErasureFact[] = [];
  const purges: Record<string, { dispatch: PayloadPurgeDispatch; receipt?: PayloadPurgeReceipt }> = {};
  let cryptoErased: PayloadCryptoEraseTombstone | undefined;
  let purgeComplete: PayloadPurgeCompletion | undefined;
  events.forEach((event, index) => {
    assertEvent(event, projectId, objectId, index);
    switch (event.type) {
      case 'object.registered':
        if (authority) throw new Error('Payload Lifecycle object is already registered');
        authority = createPayloadLifecycleObjectAuthority(event.payload.authority);
        assertGovernanceBinding(event.payload.governance, authority, 'register_object');
        assertCandidate(event.payload.governance, authority.digest);
        break;
      case 'hold.placed':
        if (!authority || holds[event.payload.id] || Object.keys(purges).length > 0
          || cryptoErased || purgeComplete) {
          throw new Error('Payload Lifecycle Hold placement is invalid');
        }
        assertGovernanceBinding(
          { request: event.payload.placeRequest, decision: event.payload.placeDecision },
          authority,
          'place_hold',
        );
        assertCandidate(
          { request: event.payload.placeRequest, decision: event.payload.placeDecision },
          digest({
            holdId: event.payload.id,
            owner: event.payload.ownerPrincipalId,
            reasonCode: event.payload.reasonCode,
            reviewAt: event.payload.reviewAt,
          }),
        );
        if (event.payload.placedAt !== event.payload.placeRequest.clock.now
          || event.payload.reviewAt <= event.payload.placedAt) {
          throw new Error('Payload Lifecycle Hold placement clock binding is invalid');
        }
        holds[event.payload.id] = deepFreeze(structuredClone(event.payload));
        break;
      case 'hold.reviewed': {
        const current = holds[event.payload.holdId];
        const nextReview = event.payload.hold.review;
        if (!current || current.release || current.review?.approved || !nextReview
          || canonicalWorkroomJson({ ...current, review: nextReview })
            !== canonicalWorkroomJson(event.payload.hold)) {
          throw new Error('Payload Lifecycle Hold review is stale');
        }
        assertGovernanceBinding(
          { request: nextReview.request, decision: nextReview.decision }, authority!, 'review_hold',
        );
        assertCandidate(
          { request: nextReview.request, decision: nextReview.decision },
          digest({
            holdId: event.payload.holdId,
            approved: nextReview.approved,
            placeAuthority: current.placeDecision.authorityDigest,
          }),
        );
        if (nextReview.reviewedAt !== nextReview.request.clock.now) {
          throw new Error('Payload Lifecycle Hold review clock binding is invalid');
        }
        holds[event.payload.holdId] = deepFreeze(structuredClone(event.payload.hold));
        break;
      }
      case 'hold.released': {
        const current = holds[event.payload.holdId];
        if (!current?.review?.approved || current.release) throw new Error('Payload Lifecycle Hold release is invalid');
        if (!event.payload.hold.release) throw new Error('Payload Lifecycle Hold release proof is unavailable');
        assertGovernanceBinding(
          { request: event.payload.hold.release.request, decision: event.payload.hold.release.decision },
          authority!,
          'release_hold',
        );
        assertCandidate(
          { request: event.payload.hold.release.request, decision: event.payload.hold.release.decision },
          digest({
            holdId: event.payload.holdId,
            placeAuthority: current.placeDecision.authorityDigest,
            reviewAuthority: current.review.decision.authorityDigest,
          }),
        );
        if (event.payload.hold.release.releasedAt !== event.payload.hold.release.request.clock.now) {
          throw new Error('Payload Lifecycle Hold release clock binding is invalid');
        }
        holds[event.payload.holdId] = deepFreeze(structuredClone(event.payload.hold));
        break;
      }
      case 'erasure.requested':
        if (!authority || !authority.subjectDigests.includes(event.payload.subjectDigest)) {
          throw new Error('Payload Lifecycle erasure subject binding is invalid');
        }
        assertGovernanceBinding(
          { request: event.payload.request, decision: event.payload.decision },
          authority,
          'request_subject_erasure',
        );
        assertCandidate(
          { request: event.payload.request, decision: event.payload.decision },
          digest({
            subjectDigest: event.payload.subjectDigest,
            resolverAuthorityDigest: event.payload.resolverAuthorityDigest,
          }),
        );
        if (event.payload.requestedAt !== event.payload.request.clock.now) {
          throw new Error('Payload subject erasure clock binding is invalid');
        }
        erasures.push(deepFreeze(structuredClone(event.payload)));
        break;
      case 'purge.requested': {
        if (!authority || event.payload.objectAuthorityDigest !== authority.digest
          || event.payload.locationManifestDigest !== authority.locations.digest
          || event.payload.digest !== digestWithoutDigest(event.payload)) {
          throw new Error('Payload purge dispatch object authority is stale');
        }
        const exactLocation = authority.locations.locations.find(location => location.id === event.payload.location.id);
        if (!exactLocation || canonicalWorkroomJson(exactLocation) !== canonicalWorkroomJson(event.payload.location)
          || event.payload.id !== purgeId(projectId, objectId, exactLocation.id)
          || event.payload.requestedAt !== event.payload.governance.request.clock.now) {
          throw new Error('Payload purge dispatch Location Manifest binding is invalid');
        }
        assertGovernanceBinding(event.payload.governance, authority);
        const allowedActions = event.payload.reason === 'subject_erasure'
          ? ['request_subject_erasure', 'reconcile_purge']
          : ['schedule_retention_purge', 'reconcile_purge'];
        if (!allowedActions.includes(event.payload.governance.request.action)) {
          throw new Error('Payload purge governance action/reason binding is invalid');
        }
        const current = purges[event.payload.id];
        switch (event.payload.governance.request.action) {
          case 'request_subject_erasure':
            if (!erasures.some(value => value.request.digest === event.payload.requestDigest)) {
              throw new Error('Payload subject erasure purge lacks its exact erasure fact');
            }
            break;
          case 'schedule_retention_purge':
            assertCandidate(
              event.payload.governance,
              digest({ deleteAfter: authority.retention.deleteAfter }),
            );
            break;
          case 'reconcile_purge':
            if (!current?.receipt) throw new Error('Payload purge reconciliation lacks its prior receipt');
            assertCandidate(
              event.payload.governance,
              digest({ purgeId: event.payload.id, receiptDigest: current.receipt.digest }),
            );
            break;
          default:
            throw new Error('Payload purge governance action is invalid');
        }
        if ((!current && (event.payload.attempt !== 1 || event.payload.fence !== 1))
          || (current && (event.payload.attempt !== current.dispatch.attempt + 1
            || event.payload.fence !== current.dispatch.fence + 1
            || current.receipt?.status === 'confirmed'))) {
          throw new Error('Payload purge retry attempt/fence is invalid');
        }
        purges[event.payload.id] = { dispatch: deepFreeze(structuredClone(event.payload)) };
        break;
      }
      case 'purge.receipt': {
        const current = purges[event.payload.purgeId];
        if (!current || current.receipt
          || !receiptMatchesDispatch(event.payload, current.dispatch)) {
          throw new Error('Payload purge receipt is stale');
        }
        assertReceipt(event.payload, current.dispatch);
        purges[event.payload.purgeId] = {
          dispatch: current.dispatch,
          receipt: deepFreeze(structuredClone(event.payload)),
        };
        break;
      }
      case 'object.crypto_erased':
        if (cryptoErased || !authority || event.payload.objectAuthorityDigest !== authority.digest
          || event.payload.locationManifestDigest !== authority.locations.digest
          || event.payload.digest !== digestWithoutDigest(event.payload)) {
          throw new Error('Payload crypto-erasure tombstone is invalid');
        }
        {
          const confirmation = Object.values(purges).find(value =>
            value.dispatch.location.id === event.payload.locationId
            && value.dispatch.location.deletionMode === 'crypto_erase'
            && value.receipt?.status === 'confirmed'
            && value.receipt.cryptoEraseReceiptDigest === event.payload.cryptoEraseReceiptDigest
            && value.receipt.observedAt === event.payload.erasedAt);
          if (!confirmation) throw new Error('Payload crypto-erasure tombstone lacks an exact confirmed receipt');
        }
        cryptoErased = deepFreeze(structuredClone(event.payload));
        break;
      case 'object.purge_complete':
        if (purgeComplete || !authority || event.payload.objectAuthorityDigest !== authority.digest
          || event.payload.locationManifestDigest !== authority.locations.digest
          || event.payload.digest !== digestWithoutDigest(event.payload)
          || Object.keys(purges).length !== authority.locations.locations.length
          || Object.values(purges).some(value => value.receipt?.status !== 'confirmed')) {
          throw new Error('Payload purge completion is not supported by all location receipts');
        }
        {
          const confirmed = Object.values(purges).map(value => value.receipt!);
          if (canonicalWorkroomJson(event.payload.receiptDigests)
              !== canonicalWorkroomJson(confirmed.map(value => value.digest).sort())
            || event.payload.completedAt !== Math.max(...confirmed.map(value => value.observedAt))) {
            throw new Error('Payload purge completion receipt summary is stale');
          }
        }
        purgeComplete = deepFreeze(structuredClone(event.payload));
        break;
    }
  });
  const sequence = events.at(-1)?.sequence ?? -1;
  const body = deepFreeze({
    projectId,
    objectId,
    sequence,
    ...(authority ? { authority } : {}),
    holds: Object.fromEntries(Object.entries(holds).sort(([left], [right]) => left.localeCompare(right))),
    erasures,
    purges: Object.fromEntries(Object.entries(purges).sort(([left], [right]) => left.localeCompare(right))),
    ...(cryptoErased ? { cryptoErased } : {}),
    ...(purgeComplete ? { purgeComplete } : {}),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface PayloadLifecycleControlPort {
  register(command: Readonly<{
    version: 1; operationId: string; authenticatedPrincipalId: string; handle: PayloadVaultObjectHandle;
  }>, signal: AbortSignal): Promise<PayloadLifecycleState>;
  placeHold(command: Readonly<{
    version: 1; operationId: string; authenticatedPrincipalId: string; projectId: string; objectId: string;
    holdId: string; ownerPrincipalId: string;
    reasonCode: PayloadRetentionHold['reasonCode'];
    reviewAt: number;
  }>, signal: AbortSignal): Promise<PayloadLifecycleState>;
  reviewHold(command: Readonly<{
    version: 1; operationId: string; authenticatedPrincipalId: string; projectId: string; objectId: string;
    holdId: string; approved: boolean;
  }>, signal: AbortSignal): Promise<PayloadLifecycleState>;
  releaseHold(command: Readonly<{
    version: 1; operationId: string; authenticatedPrincipalId: string; projectId: string; objectId: string;
    holdId: string;
  }>, signal: AbortSignal): Promise<PayloadLifecycleState>;
  requestSubjectErasure(command: Readonly<{
    version: 1; operationId: string; authenticatedPrincipalId: string; tenantId: string; projectId: string;
    subjectRef: string;
  }>, signal: AbortSignal): Promise<readonly PayloadLifecycleState[]>;
  evaluateRetention(command: Readonly<{
    version: 1; operationId: string; authenticatedPrincipalId: string; projectId: string; objectId: string;
  }>, signal: AbortSignal): Promise<PayloadLifecycleState>;
  reconcile(command: Readonly<{
    version: 1; operationId: string; authenticatedPrincipalId: string; projectId: string; objectId: string;
    purgeId: string;
  }>, signal: AbortSignal): Promise<PayloadLifecycleState>;
}

export interface PayloadLifecycleWorkerPort {
  dispatch(projectId: string, objectId: string, signal: AbortSignal): Promise<PayloadLifecycleState>;
  drainProject(projectId: string, signal: AbortSignal): Promise<readonly PayloadLifecycleState[]>;
}

export class PayloadLifecycleRuntime {
  readonly control: PayloadLifecycleControlPort;
  readonly worker: PayloadLifecycleWorkerPort;

  constructor(readonly options: Readonly<{
    journal: PayloadLifecycleJournal;
    clock: PayloadLifecycleKernelClockPort;
    authority: PayloadLifecycleCommandAuthorityPort;
    objects: PayloadLifecycleObjectAuthorityPort;
    subjects: PayloadSubjectErasureResolverPort;
    deletion: PayloadLocationDeletionPort;
    receipts: PayloadPurgeReceiptAuthorityPort;
  }>) {
    this.control = Object.freeze<PayloadLifecycleControlPort>({
      register: (command, signal) => this.#register(command, signal),
      placeHold: (command, signal) => this.#placeHold(command, signal),
      reviewHold: (command, signal) => this.#reviewHold(command, signal),
      releaseHold: (command, signal) => this.#releaseHold(command, signal),
      requestSubjectErasure: (command, signal) => this.#requestErasure(command, signal),
      evaluateRetention: (command, signal) => this.#evaluateRetention(command, signal),
      reconcile: (command, signal) => this.#reconcile(command, signal),
    });
    this.worker = Object.freeze<PayloadLifecycleWorkerPort>({
      dispatch: (projectId, objectId, signal) => this.#dispatch(projectId, objectId, signal),
      drainProject: (projectId, signal) => this.#drainProject(projectId, signal),
    });
  }

  async read(projectId: string, objectId: string): Promise<PayloadLifecycleState> {
    const events = await this.options.journal.read(projectId, objectId);
    const verifiedRequests = new Map<string, string>();
    for (const [eventIndex, event] of events.entries()) {
      const stateBefore = replayPayloadLifecycle(projectId, objectId, events.slice(0, event.sequence));
      for (const proof of eventAuthorityProofs(event)) {
        const firstStateDigest = verifiedRequests.get(proof.request.digest);
        if (firstStateDigest === undefined) {
          if (proof.request.currentStateDigest !== stateBefore.digest) {
            throw new Error('Payload Lifecycle persisted governance proof state binding is stale');
          }
          verifiedRequests.set(proof.request.digest, stateBefore.digest);
        } else if (firstStateDigest !== proof.request.currentStateDigest) {
          throw new Error('Payload Lifecycle persisted governance proof replay binding is stale');
        }
        if (!await this.options.authority.verify(proof.request, proof.decision)) {
          throw new Error('Payload Lifecycle persisted governance proof is untrusted');
        }
      }
      if (event.type === 'purge.receipt') {
        const dispatch = stateBefore.purges[event.payload.purgeId]?.dispatch;
        if (!dispatch || !await this.options.receipts.verify(event.payload, dispatch)) {
          throw new Error('Payload Lifecycle persisted purge receipt is untrusted');
        }
        if (event.payload.status === 'confirmed' && dispatch.location.deletionMode === 'crypto_erase') {
          const tombstone = events[eventIndex + 1];
          if (!tombstone || tombstone.type !== 'object.crypto_erased'
            || tombstone.payload.cryptoEraseReceiptDigest !== event.payload.cryptoEraseReceiptDigest
            || tombstone.payload.locationId !== event.payload.locationId) {
            throw new Error('Payload crypto-erasure confirmation lacks its atomic tombstone');
          }
        }
      }
    }
    return replayPayloadLifecycle(projectId, objectId, events);
  }

  async #register(command: Parameters<PayloadLifecycleControlPort['register']>[0], signal: AbortSignal) {
    exactKeys(command, ['version', 'operationId', 'authenticatedPrincipalId', 'handle'], 'register command');
    header(command, signal);
    const object = await this.options.objects.resolve(command.handle, signal);
    if (!object || canonicalWorkroomJson(object.handle) !== canonicalWorkroomJson(command.handle)) {
      throw new Error('Trusted Payload Lifecycle object authority is unavailable');
    }
    const current = await this.read(object.handle.projectId, object.handle.objectId);
    if (current.authority) {
      if (current.authority.digest !== object.digest) throw new Error('Payload Lifecycle object authority drift');
      return current;
    }
    const clock = await this.#clock(command.operationId, object.handle.projectId, object.handle.objectId, 'control');
    const governance = await this.#authorize(
      'register_object', 'data_steward', command, object, current, object.digest, clock,
    );
    await this.options.journal.append(object.handle.projectId, object.handle.objectId, current.sequence, [{
      type: 'object.registered', payload: { authority: object, governance },
    }]);
    return await this.read(object.handle.projectId, object.handle.objectId);
  }

  async #placeHold(command: Parameters<PayloadLifecycleControlPort['placeHold']>[0], signal: AbortSignal) {
    exactKeys(command, [
      'version', 'operationId', 'authenticatedPrincipalId', 'projectId', 'objectId',
      'holdId', 'ownerPrincipalId', 'reasonCode', 'reviewAt',
    ], 'place Hold command');
    header(command, signal);
    text(command.holdId, 'Hold id');
    text(command.ownerPrincipalId, 'Hold owner');
    if (command.ownerPrincipalId !== command.authenticatedPrincipalId) throw new Error('Hold owner must place the Hold');
    if (!['legal_hold', 'investigation', 'regulatory_preservation'].includes(command.reasonCode)) {
      throw new Error('Hold reason code is invalid');
    }
    if (!Number.isSafeInteger(command.reviewAt) || command.reviewAt < 0) {
      throw new Error('Hold reviewAt is invalid');
    }
    const state = await this.#registered(command.projectId, command.objectId);
    const existing = state.holds[command.holdId];
    if (existing) {
      if (existing.ownerPrincipalId !== command.ownerPrincipalId
        || existing.reasonCode !== command.reasonCode
        || existing.reviewAt !== command.reviewAt) {
        throw new Error('Retention Hold idempotency binding drift');
      }
      return state;
    }
    if (Object.keys(state.purges).length > 0 || state.cryptoErased || state.purgeComplete) {
      throw new Error('Retention Hold cannot be placed after deletion is scheduled');
    }
    const clock = await this.#clock(command.operationId, command.projectId, command.objectId, 'control');
    if (command.reviewAt <= clock.now) throw new Error('Hold reviewAt must be after placement time');
    const candidate = digest({
      holdId: command.holdId,
      owner: command.ownerPrincipalId,
      reasonCode: command.reasonCode,
      reviewAt: command.reviewAt,
    });
    const proof = await this.#authorize(
      'place_hold', 'data_steward', command, state.authority!, state, candidate, clock,
    );
    const hold = deepFreeze<PayloadRetentionHold>({
      id: command.holdId,
      ownerPrincipalId: command.ownerPrincipalId,
      reasonCode: command.reasonCode,
      placedAt: clock.now,
      reviewAt: command.reviewAt,
      placeRequest: proof.request,
      placeDecision: proof.decision,
    });
    await this.options.journal.append(command.projectId, command.objectId, state.sequence, [{
      type: 'hold.placed', payload: hold,
    }]);
    return await this.read(command.projectId, command.objectId);
  }

  async #reviewHold(command: Parameters<PayloadLifecycleControlPort['reviewHold']>[0], signal: AbortSignal) {
    exactKeys(command, [
      'version', 'operationId', 'authenticatedPrincipalId', 'projectId', 'objectId', 'holdId', 'approved',
    ], 'review Hold command');
    header(command, signal);
    if (typeof command.approved !== 'boolean') throw new Error('Hold review decision is invalid');
    const state = await this.#registered(command.projectId, command.objectId);
    const hold = state.holds[command.holdId];
    if (!hold) throw new Error('Retention Hold is unavailable');
    if (hold.review?.approved) {
      if (!command.approved || hold.review.reviewerPrincipalId !== command.authenticatedPrincipalId) {
        throw new Error('Retention Hold review idempotency binding drift');
      }
      return state;
    }
    const clock = await this.#clock(command.operationId, command.projectId, command.objectId, 'control');
    const proof = await this.#authorize(
      'review_hold', 'compliance', command, state.authority!, state,
      digest({ holdId: command.holdId, approved: command.approved, placeAuthority: hold.placeDecision.authorityDigest }),
      clock,
    );
    if (command.authenticatedPrincipalId === hold.ownerPrincipalId
      && proof.decision.separationPolicy?.allowsSelfReview !== true) {
      throw new Error('Retention Hold owner cannot self-review without exact separation policy');
    }
    const next = deepFreeze<PayloadRetentionHold>({
      ...structuredClone(hold),
      review: {
        approved: command.approved,
        reviewerPrincipalId: command.authenticatedPrincipalId,
        reviewedAt: clock.now,
        request: proof.request,
        decision: proof.decision,
      },
    });
    await this.options.journal.append(command.projectId, command.objectId, state.sequence, [{
      type: 'hold.reviewed', payload: { holdId: hold.id, hold: next },
    }]);
    return await this.read(command.projectId, command.objectId);
  }

  async #releaseHold(command: Parameters<PayloadLifecycleControlPort['releaseHold']>[0], signal: AbortSignal) {
    exactKeys(command, [
      'version', 'operationId', 'authenticatedPrincipalId', 'projectId', 'objectId', 'holdId',
    ], 'release Hold command');
    header(command, signal);
    const state = await this.#registered(command.projectId, command.objectId);
    const hold = state.holds[command.holdId];
    if (!hold?.review?.approved) throw new Error('Retention Hold requires an approved independent review');
    if (command.authenticatedPrincipalId !== hold.ownerPrincipalId) throw new Error('Only the Hold owner can release it');
    if (hold.release) return state;
    if (hold.review.reviewerPrincipalId === hold.ownerPrincipalId
      && hold.review.decision.separationPolicy?.allowsSelfReview !== true) {
      throw new Error('Retention Hold release lacks an independent review');
    }
    const clock = await this.#clock(command.operationId, command.projectId, command.objectId, 'control');
    const proof = await this.#authorize(
      'release_hold', 'data_steward', command, state.authority!, state,
      digest({ holdId: hold.id, placeAuthority: hold.placeDecision.authorityDigest,
        reviewAuthority: hold.review.decision.authorityDigest }),
      clock,
    );
    const next = deepFreeze<PayloadRetentionHold>({
      ...structuredClone(hold),
      release: {
        releasedBy: command.authenticatedPrincipalId,
        releasedAt: clock.now,
        request: proof.request,
        decision: proof.decision,
      },
    });
    await this.options.journal.append(command.projectId, command.objectId, state.sequence, [{
      type: 'hold.released', payload: { holdId: hold.id, hold: next },
    }]);
    return await this.read(command.projectId, command.objectId);
  }

  async #requestErasure(
    command: Parameters<PayloadLifecycleControlPort['requestSubjectErasure']>[0],
    signal: AbortSignal,
  ) {
    exactKeys(command, [
      'version', 'operationId', 'authenticatedPrincipalId', 'tenantId', 'projectId', 'subjectRef',
    ], 'subject erasure command');
    header(command, signal);
    text(command.tenantId, 'subject erasure tenantId');
    text(command.projectId, 'subject erasure projectId');
    text(command.subjectRef, 'subject erasure subjectRef');
    const resolution = await this.options.subjects.resolve({
      tenantId: command.tenantId, projectId: command.projectId, subjectRef: command.subjectRef,
    }, signal);
    assertSubjectResolution(resolution, command.tenantId, command.projectId);
    const results: PayloadLifecycleState[] = [];
    for (const handle of resolution.handles) {
      signal.throwIfAborted();
      const state = await this.#registered(command.projectId, handle.objectId);
      if (state.authority!.handle.tenantId !== command.tenantId
        || !state.authority!.subjectDigests.includes(resolution.subjectDigest)) {
        throw new Error('Subject erasure resolution escaped its trusted object authority');
      }
      if (state.erasures.some(value => value.subjectDigest === resolution.subjectDigest)) {
        results.push(state);
        continue;
      }
      const clock = await this.#clock(command.operationId, command.projectId, handle.objectId, 'control');
      this.#assertNoActiveHold(state);
      const proof = await this.#authorize(
        'request_subject_erasure', 'privacy', command, state.authority!, state,
        digest({ subjectDigest: resolution.subjectDigest, resolverAuthorityDigest: resolution.authorityDigest }),
        clock,
      );
      if (clock.now < state.authority!.retention.minimumRetainUntil) {
        const override = proof.decision.minimumRetentionOverride;
        if (!override || override.objectAuthorityDigest !== state.authority!.digest) {
          throw new Error('Subject erasure cannot override minimum retention without exact legal policy authority');
        }
        requiredDigest(override.policyDigest, 'minimum retention override policy digest');
        text(override.policyRef, 'minimum retention override policy ref');
      }
      const fact = deepFreeze<PayloadSubjectErasureFact>({
        subjectDigest: resolution.subjectDigest,
        requestedAt: clock.now,
        request: proof.request,
        decision: proof.decision,
        resolverAuthorityDigest: resolution.authorityDigest,
      });
      const drafts: PayloadLifecycleEventDraft[] = [{ type: 'erasure.requested', payload: fact }];
      if (Object.keys(state.purges).length === 0 && !state.purgeComplete) {
        drafts.push(...purgeDrafts(state, 'subject_erasure', clock.now, proof));
      }
      await this.options.journal.append(command.projectId, handle.objectId, state.sequence, drafts);
      results.push(await this.read(command.projectId, handle.objectId));
    }
    return deepFreeze(results);
  }

  async #evaluateRetention(
    command: Parameters<PayloadLifecycleControlPort['evaluateRetention']>[0],
    signal: AbortSignal,
  ) {
    exactKeys(command, [
      'version', 'operationId', 'authenticatedPrincipalId', 'projectId', 'objectId',
    ], 'retention evaluation command');
    header(command, signal);
    const state = await this.#registered(command.projectId, command.objectId);
    if (state.purgeComplete || Object.keys(state.purges).length > 0) return state;
    const clock = await this.#clock(command.operationId, command.projectId, command.objectId, 'retention');
    if (clock.now < state.authority!.retention.deleteAfter) throw new Error('Payload retention has not expired');
    this.#assertNoActiveHold(state);
    const proof = await this.#authorize(
      'schedule_retention_purge', 'data_steward', command, state.authority!, state,
      digest({ deleteAfter: state.authority!.retention.deleteAfter }), clock,
    );
    await this.options.journal.append(command.projectId, command.objectId, state.sequence,
      purgeDrafts(state, 'retention_expired', clock.now, proof));
    return await this.read(command.projectId, command.objectId);
  }

  async #reconcile(command: Parameters<PayloadLifecycleControlPort['reconcile']>[0], signal: AbortSignal) {
    exactKeys(command, [
      'version', 'operationId', 'authenticatedPrincipalId', 'projectId', 'objectId', 'purgeId',
    ], 'purge reconciliation command');
    header(command, signal);
    const state = await this.#registered(command.projectId, command.objectId);
    const current = state.purges[command.purgeId];
    if (!current?.receipt || current.receipt.status === 'confirmed') {
      throw new Error('Payload purge is not eligible for reconciliation');
    }
    const clock = await this.#clock(command.operationId, command.projectId, command.objectId, 'reconciliation');
    const proof = await this.#authorize(
      'reconcile_purge', 'data_steward', command, state.authority!, state,
      digest({ purgeId: command.purgeId, receiptDigest: current.receipt.digest }), clock,
    );
    const { digest: _currentDigest, ...currentDispatch } = current.dispatch;
    const retry = createPurgeDispatch({
      ...currentDispatch,
      attempt: current.dispatch.attempt + 1,
      fence: current.dispatch.fence + 1,
      requestedAt: clock.now,
      requestDigest: proof.request.digest,
      governance: proof,
    });
    await this.options.journal.append(command.projectId, command.objectId, state.sequence, [{
      type: 'purge.requested', payload: retry,
    }]);
    return await this.read(command.projectId, command.objectId);
  }

  async #dispatch(projectId: string, objectId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    let state = await this.#registered(projectId, objectId);
    const pending = Object.values(state.purges)
      .filter(value => !value.receipt)
      .sort((left, right) => left.dispatch.location.id.localeCompare(right.dispatch.location.id));
    for (const item of pending) {
      const receipt = await this.options.deletion.purge(item.dispatch, signal);
      assertReceipt(receipt, item.dispatch);
      if (!await this.options.receipts.verify(receipt, item.dispatch)) {
        throw new Error('Payload purge receipt authority denied the observation');
      }
      const drafts: PayloadLifecycleEventDraft[] = [{ type: 'purge.receipt', payload: receipt }];
      if (receipt.status === 'confirmed' && item.dispatch.location.deletionMode === 'crypto_erase') {
        if (!receipt.cryptoEraseReceiptDigest) throw new Error('Crypto erase confirmation lacks a receipt digest');
        const body = deepFreeze({
          version: 1 as const,
          projectId,
          objectId,
          vaultObjectId: state.authority!.handle.vaultObjectId,
          objectAuthorityDigest: state.authority!.digest,
          locationManifestDigest: state.authority!.locations.digest,
          locationId: item.dispatch.location.id,
          cryptoEraseReceiptDigest: receipt.cryptoEraseReceiptDigest,
          erasedAt: receipt.observedAt,
        });
        drafts.push({ type: 'object.crypto_erased', payload: deepFreeze({ ...body, digest: digest(body) }) });
      }
      await this.options.journal.append(projectId, objectId, state.sequence, drafts);
      state = await this.read(projectId, objectId);
    }
    if (!state.purgeComplete
      && Object.keys(state.purges).length === state.authority!.locations.locations.length
      && Object.values(state.purges).every(value => value.receipt?.status === 'confirmed')) {
      const receipts = Object.values(state.purges).map(value => value.receipt!.digest).sort();
      const completedAt = Math.max(...Object.values(state.purges).map(value => value.receipt!.observedAt));
      const body = deepFreeze({
        version: 1 as const,
        projectId,
        objectId,
        objectAuthorityDigest: state.authority!.digest,
        locationManifestDigest: state.authority!.locations.digest,
        completedAt,
        receiptDigests: receipts,
      });
      await this.options.journal.append(projectId, objectId, state.sequence, [{
        type: 'object.purge_complete', payload: deepFreeze({ ...body, digest: digest(body) }),
      }]);
      state = await this.read(projectId, objectId);
    }
    return state;
  }

  async #drainProject(projectId: string, signal: AbortSignal) {
    text(projectId, 'Lifecycle Project id');
    const states: PayloadLifecycleState[] = [];
    for (const objectId of await this.options.journal.listObjectIds(projectId)) {
      signal.throwIfAborted();
      const state = await this.read(projectId, objectId);
      const purges = Object.values(state.purges);
      const hasPendingAttempt = purges.some(value => !value.receipt);
      const needsCompletionRecovery = purges.length === state.authority?.locations.locations.length
        && purges.length > 0
        && purges.every(value => value.receipt?.status === 'confirmed');
      if (state.purgeComplete || (!hasPendingAttempt && !needsCompletionRecovery)) continue;
      states.push(await this.#dispatch(projectId, objectId, signal));
    }
    return deepFreeze(states);
  }

  async #registered(projectId: string, objectId: string) {
    const state = await this.read(projectId, objectId);
    if (!state.authority) throw new Error('Payload Lifecycle object is not registered');
    return state;
  }

  async #clock(
    operationId: string,
    projectId: string,
    objectId: string,
    purpose: 'control' | 'retention' | 'reconciliation',
  ) {
    const value = await this.options.clock.read({ operationId, projectId, objectId, purpose });
    if (!value) throw new Error('Payload Lifecycle Kernel clock authority is unavailable');
    const canonical = createPayloadLifecycleClockSnapshot(value);
    if (canonicalWorkroomJson(canonical) !== canonicalWorkroomJson(value)) {
      throw new Error('Payload Lifecycle Kernel clock digest drift');
    }
    return canonical;
  }

  async #authorize(
    action: PayloadLifecycleAuthorityAction,
    requiredRole: PayloadLifecycleRole,
    command: Readonly<{ operationId: string; authenticatedPrincipalId: string }>,
    object: PayloadLifecycleObjectAuthority,
    state: PayloadLifecycleState,
    candidateDigest: string,
    clock: PayloadLifecycleClockSnapshot,
  ) {
    const body = deepFreeze({
      version: 1 as const,
      action,
      requiredRole,
      operationId: command.operationId,
      authenticatedPrincipalId: command.authenticatedPrincipalId,
      tenantId: object.handle.tenantId,
      projectId: object.handle.projectId,
      objectId: object.handle.objectId,
      objectAuthorityDigest: object.digest,
      currentStateDigest: state.digest,
      candidateDigest: requiredDigest(candidateDigest, 'Lifecycle candidate digest'),
      clock,
    });
    const request = deepFreeze<PayloadLifecycleAuthorityRequest>({ ...body, digest: digest(body) });
    const result = await this.options.authority.authorize(request);
    if (!result.approved) {
      if (result.requestDigest !== request.digest) throw new Error('Lifecycle authority denial echo mismatch');
      throw new Error(`Lifecycle authority denied: ${result.reason}`);
    }
    if (result.requestDigest !== request.digest
      || result.principalId !== request.authenticatedPrincipalId
      || result.role !== requiredRole
      || !await this.options.authority.verify(request, result)) {
      throw new Error('Lifecycle authority exact decision echo mismatch');
    }
    requiredDigest(result.authorityDigest, 'Lifecycle authority digest');
    text(result.decisionId, 'Lifecycle decision id');
    nonNegative(result.decidedAt, 'Lifecycle decision timestamp');
    return deepFreeze({ request, decision: structuredClone(result) });
  }

  #assertNoActiveHold(state: PayloadLifecycleState): void {
    if (Object.values(state.holds).some(hold => !hold.release)) {
      throw new Error('Payload Lifecycle purge is blocked by an active Retention Hold');
    }
  }
}

function purgeDrafts(
  state: PayloadLifecycleState,
  reason: PayloadPurgeDispatch['reason'],
  requestedAt: number,
  governance: PayloadLifecycleGovernanceProof,
): PayloadLifecycleEventDraft[] {
  return state.authority!.locations.locations.map(location => ({
    type: 'purge.requested' as const,
    payload: createPurgeDispatch({
      id: purgeId(state.projectId, state.objectId, location.id),
      reason,
      objectAuthorityDigest: state.authority!.digest,
      locationManifestDigest: state.authority!.locations.digest,
      location,
      attempt: 1,
      fence: 1,
      requestedAt,
      requestDigest: governance.request.digest,
      governance,
    }),
  }));
}

function createPurgeDispatch(input: Omit<PayloadPurgeDispatch, 'digest'>): PayloadPurgeDispatch {
  text(input.id, 'Purge id');
  positive(input.attempt, 'Purge attempt');
  positive(input.fence, 'Purge fence');
  nonNegative(input.requestedAt, 'Purge requestedAt');
  requiredDigest(input.objectAuthorityDigest, 'Purge object authority digest');
  requiredDigest(input.locationManifestDigest, 'Purge Location Manifest digest');
  requiredDigest(input.location.authorityDigest, 'Purge location authority digest');
  requiredDigest(input.requestDigest, 'Purge request digest');
  if (input.requestDigest !== input.governance.request.digest) {
    throw new Error('Purge governance request binding is invalid');
  }
  const body = deepFreeze(structuredClone(input));
  return deepFreeze({ ...body, digest: digest(body) });
}

function purgeId(projectId: string, objectId: string, locationId: string): string {
  return `purge:${digest({ projectId, objectId, locationId })}`;
}

function assertReceipt(receipt: PayloadPurgeReceipt, dispatch: PayloadPurgeDispatch): void {
  const { digest: supplied, ...body } = receipt;
  if (receipt.version !== 1 || supplied !== digest(body) || !receiptMatchesDispatch(receipt, dispatch)
    || !['confirmed', 'failed', 'outcome_unknown'].includes(receipt.status)
    || !Number.isSafeInteger(receipt.observedAt) || receipt.observedAt < dispatch.requestedAt) {
    throw new Error('Payload purge receipt is malformed or stale');
  }
  text(receipt.authenticatedBy, 'Purge receipt authority');
  requiredDigest(receipt.authorityDigest, 'Purge receipt authority digest');
  if (receipt.status === 'confirmed' && receipt.reasonCode !== undefined) {
    throw new Error('Confirmed Payload purge receipt cannot carry a failure reason');
  }
  if (receipt.status !== 'confirmed' && receipt.reasonCode === undefined) {
    throw new Error('Unconfirmed Payload purge receipt requires a bounded reason code');
  }
  if (receipt.reasonCode !== undefined && ![
    'unsupported', 'provider_denied', 'transient_failure', 'timeout', 'unknown_external_copy',
  ].includes(receipt.reasonCode)) {
    throw new Error('Payload purge receipt reason code is invalid');
  }
  if (receipt.cryptoEraseReceiptDigest !== undefined) {
    requiredDigest(receipt.cryptoEraseReceiptDigest, 'Crypto erase receipt digest');
  }
  if (dispatch.location.deletionMode === 'crypto_erase') {
    if (receipt.status === 'confirmed' && receipt.cryptoEraseReceiptDigest === undefined) {
      throw new Error('Confirmed crypto erase receipt lacks its exact key-destruction proof');
    }
    if (receipt.status !== 'confirmed' && receipt.cryptoEraseReceiptDigest !== undefined) {
      throw new Error('Unconfirmed crypto erase receipt cannot claim key destruction');
    }
  } else if (receipt.cryptoEraseReceiptDigest !== undefined) {
    throw new Error('Non-crypto purge receipt cannot claim key destruction');
  }
}

function receiptMatchesDispatch(receipt: PayloadPurgeReceipt, dispatch: PayloadPurgeDispatch): boolean {
  return receipt.purgeId === dispatch.id
    && receipt.locationId === dispatch.location.id
    && receipt.locationAuthorityDigest === dispatch.location.authorityDigest
    && receipt.locationManifestDigest === dispatch.locationManifestDigest
    && receipt.attempt === dispatch.attempt
    && receipt.fence === dispatch.fence
    && receipt.requestDigest === dispatch.requestDigest;
}

function assertGovernanceBinding(
  proof: PayloadLifecycleGovernanceProof,
  object: PayloadLifecycleObjectAuthority,
  exactAction?: PayloadLifecycleAuthorityAction,
): void {
  if (!proof || proof.request.digest !== digestWithoutDigest(proof.request)
    || canonicalWorkroomJson(createPayloadLifecycleClockSnapshot(proof.request.clock))
      !== canonicalWorkroomJson(proof.request.clock)
    || proof.decision.requestDigest !== proof.request.digest
    || proof.decision.principalId !== proof.request.authenticatedPrincipalId
    || proof.decision.role !== proof.request.requiredRole
    || proof.request.tenantId !== object.handle.tenantId
    || proof.request.projectId !== object.handle.projectId
    || proof.request.objectId !== object.handle.objectId
    || proof.request.objectAuthorityDigest !== object.digest
    || proof.request.requiredRole !== roleForAction(proof.request.action)
    || (exactAction !== undefined && proof.request.action !== exactAction)) {
    throw new Error('Payload Lifecycle governance proof binding is invalid');
  }
  requiredDigest(proof.decision.authorityDigest, 'Lifecycle authority digest');
  if (proof.decision.separationPolicy) {
    requiredDigest(proof.decision.separationPolicy.policyDigest, 'separation policy digest');
  }
  if (proof.decision.minimumRetentionOverride) {
    text(proof.decision.minimumRetentionOverride.policyRef, 'minimum retention override policy ref');
    requiredDigest(proof.decision.minimumRetentionOverride.policyDigest, 'minimum retention override policy digest');
    requiredDigest(
      proof.decision.minimumRetentionOverride.objectAuthorityDigest,
      'minimum retention override object authority digest',
    );
  }
}

function assertCandidate(proof: PayloadLifecycleGovernanceProof, candidateDigest: string): void {
  if (proof.request.candidateDigest !== candidateDigest) {
    throw new Error('Payload Lifecycle governance candidate binding is stale');
  }
}

function roleForAction(action: PayloadLifecycleAuthorityAction): PayloadLifecycleRole {
  switch (action) {
    case 'request_subject_erasure': return 'privacy';
    case 'review_hold': return 'compliance';
    case 'register_object':
    case 'place_hold':
    case 'release_hold':
    case 'schedule_retention_purge':
    case 'reconcile_purge':
      return 'data_steward';
  }
}

function eventAuthorityProofs(event: PayloadLifecycleEvent): readonly Readonly<{
  request: PayloadLifecycleAuthorityRequest;
  decision: PayloadLifecycleAuthorityDecision;
}>[] {
  switch (event.type) {
    case 'object.registered': return [event.payload.governance];
    case 'hold.placed': return [{ request: event.payload.placeRequest, decision: event.payload.placeDecision }];
    case 'hold.reviewed': return event.payload.hold.review
      ? [{ request: event.payload.hold.review.request, decision: event.payload.hold.review.decision }]
      : [];
    case 'hold.released': return event.payload.hold.release
      ? [{ request: event.payload.hold.release.request, decision: event.payload.hold.release.decision }]
      : [];
    case 'erasure.requested': return [{ request: event.payload.request, decision: event.payload.decision }];
    case 'purge.requested': return [event.payload.governance];
    default: return [];
  }
}

function assertEvent(event: PayloadLifecycleEvent, projectId: string, objectId: string, sequence: number): void {
  if (event.version !== 1 || event.projectId !== projectId || event.objectId !== objectId
    || event.sequence !== sequence) throw new Error('Payload Lifecycle event identity/sequence is invalid');
  const { digest: supplied, ...body } = event;
  if (supplied !== digest(body)) throw new Error('Payload Lifecycle event digest mismatch');
}

function digestWithoutDigest(value: Readonly<{ digest: string }>): string {
  const { digest: _supplied, ...body } = value;
  return digest(body);
}

function assertSubjectResolution(
  value: PayloadSubjectErasureResolution | undefined,
  tenantId: string,
  projectId: string,
): asserts value is PayloadSubjectErasureResolution {
  if (!value || value.version !== 1 || value.tenantId !== tenantId || value.projectId !== projectId
    || !Array.isArray(value.handles) || value.handles.length === 0) {
    throw new Error('Trusted subject erasure resolution is unavailable');
  }
  requiredDigest(value.subjectDigest, 'subject digest');
  requiredDigest(value.authorityDigest, 'subject resolver authority digest');
  const { digest: supplied, ...body } = value;
  if (supplied !== digest(body)) throw new Error('Subject erasure resolution digest mismatch');
  value.handles.forEach(assertHandle);
}

function assertHandle(value: PayloadVaultObjectHandle): void {
  if (!value || value.version !== 1) throw new Error('Payload Vault handle is invalid');
  text(value.vaultObjectId, 'Vault object id');
  text(value.objectId, 'Payload object id');
  text(value.tenantId, 'Payload tenant id');
  text(value.projectId, 'Payload Project id');
  requiredDigest(value.payloadHash, 'Payload hash');
  requiredDigest(value.descriptorDigest, 'Payload Descriptor digest');
  requiredDigest(value.locationManifestDigest, 'Payload Location Manifest digest');
}

function header(
  command: Readonly<{ version: 1; operationId: string; authenticatedPrincipalId: string }>,
  signal: AbortSignal,
): void {
  signal.throwIfAborted();
  if (command.version !== 1) throw new Error('Payload Lifecycle command version is invalid');
  text(command.operationId, 'Payload Lifecycle operation id');
  text(command.authenticatedPrincipalId, 'Payload Lifecycle authenticated principal');
}

function exactKeys(value: object, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Payload Lifecycle ${label} contains forbidden field ${key}`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new Error(`Payload Lifecycle ${label} is missing ${key}`);
  }
}

function uniqueDigests(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values)) throw new Error(`${label} list is invalid`);
  const normalized = [...new Set(values.map(value => requiredDigest(value, label)))].sort();
  if (normalized.length !== values.length || canonicalWorkroomJson(normalized) !== canonicalWorkroomJson(values)) {
    throw new Error(`${label} list is non-canonical`);
  }
  return deepFreeze(normalized);
}

function text(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()
    || value.length > 512 || [...value].some(character => {
      const code = character.codePointAt(0)!;
      return code <= 31 || code === 127;
    })) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requiredDigest(value: string, label: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive`);
  return value;
}

function nonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}
