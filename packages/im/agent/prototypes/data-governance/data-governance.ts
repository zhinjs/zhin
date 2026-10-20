/**
 * PROTOTYPE — decision-map ticket #12. Delete after the contract is absorbed.
 *
 * Question: can one Data Governance Policy decide every Context/Evidence/
 * projection/A2A disclosure and every retention transition without storing
 * sensitive payloads in an immutable Journal or trusting an LLM to redact?
 */
import { createHash } from 'node:crypto';

export type Confidentiality = 'unknown' | 'public' | 'project_internal' | 'confidential' | 'restricted';
export type DataKind =
  | 'source_message'
  | 'workroom_fact'
  | 'context_digest'
  | 'task_report'
  | 'artifact'
  | 'evidence'
  | 'execution_trace'
  | 'projection_payload';
export type RetentionClass = 'transient' | 'operational' | 'project_record' | 'regulated_record';
export type DisclosureChannel = 'context_view' | 'evidence_port' | 'workroom_projection' | 'sponsor_projection' | 'console' | 'a2a';
export type DisclosurePurpose =
  | 'orchestration'
  | 'task_execution'
  | 'acceptance_review'
  | 'workroom_awareness'
  | 'portfolio_oversight'
  | 'remote_execution'
  | 'audit'
  | 'reconciliation';

export interface RetentionWindow {
  readonly minimumTicks: number;
  readonly maximumTicks: number;
}

export interface TrustedTransformDeclaration {
  readonly id: 'support.case-redact:v1' | 'support.status:v1' | 'investment.aggregate:v1' | 'investment.status:v1';
  readonly inputCategoriesAny: readonly string[];
  readonly outputClassification: Exclude<Confidentiality, 'unknown'>;
  readonly outputCategories: readonly string[];
  readonly allowedChannels: readonly DisclosureChannel[];
  readonly breaksSubjectLink: boolean;
}

export interface DataGovernancePolicy {
  readonly id: string;
  readonly revision: number;
  readonly tenantId: string;
  readonly projectId: string;
  readonly allowedRegions: readonly string[];
  readonly allowedDestinationIds: readonly string[];
  readonly destinationCatalog: Readonly<Record<string, DisclosureDestination>>;
  readonly categoryFloor: Readonly<Record<string, Exclude<Confidentiality, 'unknown'>>>;
  readonly kindFloor: Readonly<Record<DataKind, Exclude<Confidentiality, 'unknown'>>>;
  readonly channelMaximum: Readonly<Record<DisclosureChannel, Exclude<Confidentiality, 'unknown'>>>;
  readonly retention: Readonly<Record<RetentionClass, RetentionWindow>>;
  readonly transformIds: readonly TrustedTransformDeclaration['id'][];
  readonly transformCatalog: Readonly<Record<string, TrustedTransformDeclaration>>;
  readonly externalApprovalAtOrAbove: Exclude<Confidentiality, 'unknown'>;
  readonly crossProjectExport: boolean;
}

export interface GovernedObjectInput {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly kind: DataKind;
  readonly payload: string;
  readonly proposedClassification: Confidentiality;
  readonly categories: readonly string[];
  readonly allowedPurposes: readonly DisclosurePurpose[];
  readonly allowedRegions: readonly string[];
  readonly retentionClass: RetentionClass;
  readonly subjectRefs: readonly string[];
  readonly locations: readonly string[];
  readonly sourceObjectIds?: readonly string[];
  readonly transformRef?: string;
  readonly inheritedRetention?: Readonly<{ minimumRetainUntil: number; deleteAfter: number }>;
  readonly subjectLinkage?: 'linked' | 'deidentified';
}

export interface DataDescriptor {
  readonly objectId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly kind: DataKind;
  readonly payloadHash: string;
  readonly classification: Confidentiality;
  readonly categories: readonly string[];
  readonly allowedPurposes: readonly DisclosurePurpose[];
  readonly allowedRegions: readonly string[];
  readonly retentionClass: RetentionClass;
  readonly subjectRefs: readonly string[];
  readonly subjectLinkage: 'linked' | 'deidentified';
  readonly sourceObjectIds: readonly string[];
  readonly transformRef?: string;
  readonly createdAt: number;
  readonly minimumRetainUntil: number;
  readonly deleteAfter: number;
  readonly classificationPolicyRevision: number;
}

export interface GovernedObject {
  readonly descriptor: DataDescriptor;
  readonly payload?: string;
  readonly status: 'active' | 'quarantined' | 'purge_pending' | 'purged';
  readonly locations: Readonly<Record<string, 'active' | 'purge_pending' | 'purged' | 'outcome_unknown'>>;
}

export interface RetentionHold {
  readonly id: string;
  readonly objectId: string;
  readonly owner: string;
  readonly reason: string;
  readonly reviewAt: number;
  readonly status: 'active' | 'released';
}

export interface ErasureRequest {
  readonly id: string;
  readonly subjectRef: string;
  readonly requestedBy: string;
  readonly requestedAt: number;
}

export interface PurgeReceipt {
  readonly id: string;
  readonly objectId: string;
  readonly location: string;
  readonly outcome: 'purged' | 'outcome_unknown';
}

export interface RecipientSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly clearance: Exclude<Confidentiality, 'unknown'>;
}

export interface DisclosureDestination {
  readonly id: string;
  readonly contractDigest: string;
  readonly kind: 'local_model' | 'external_model' | 'workroom_im' | 'sponsor_im' | 'console' | 'a2a_agent';
  readonly tenantId: string;
  readonly projectId?: string;
  readonly trustDomain: string;
  readonly processingRegions: readonly string[];
  readonly maxClassification: Exclude<Confidentiality, 'unknown'>;
  readonly allowedCategories: readonly string[];
  readonly external: boolean;
  readonly noTraining: boolean;
  readonly supportsDeletion: boolean;
  readonly membershipRevision?: number;
  readonly recipients?: readonly RecipientSnapshot[];
}

export interface DisclosureEnvelope {
  readonly principalId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly role: 'orchestrator' | 'executor' | 'reviewer' | 'sponsor' | 'auditor' | 'projector';
  readonly clearance: Exclude<Confidentiality, 'unknown'>;
  readonly allowedPurposes: readonly DisclosurePurpose[];
  readonly governancePolicyRevision: number;
  readonly assignmentId?: string;
  readonly portfolioProjectIds?: readonly string[];
}

export interface DisclosureApproval {
  readonly id: string;
  readonly requestDigest: string;
  readonly role: 'data_steward' | 'compliance';
  readonly expiresAt: number;
  readonly decision: 'approved' | 'rejected';
}

export interface DisclosureRequest {
  readonly objectId: string;
  readonly channel: DisclosureChannel;
  readonly purpose: DisclosurePurpose;
  readonly envelope: DisclosureEnvelope;
  readonly destination: DisclosureDestination;
  readonly requestedMode: 'full' | 'metadata_only';
}

export type DisclosureDisposition =
  | 'allow_full'
  | 'allow_metadata_only'
  | 'transform_required'
  | 'approval_required'
  | 'deny';

export interface DisclosureDecision {
  readonly disposition: DisclosureDisposition;
  readonly requestDigest: string;
  readonly reasons: readonly string[];
  readonly requiredTransformId?: TrustedTransformDeclaration['id'];
  readonly requiredApprovalRoles: readonly DisclosureApproval['role'][];
  readonly policyRevision: number;
}

export interface DisclosureManifest {
  readonly id: string;
  readonly objectId: string;
  readonly sourcePayloadHash: string;
  readonly disclosedContentHash: string;
  readonly requestDigest: string;
  readonly channel: DisclosureChannel;
  readonly purpose: DisclosurePurpose;
  readonly destinationId: string;
  readonly destinationTrustDomain: string;
  readonly mode: 'full' | 'metadata_only';
  readonly policyRevision: number;
  readonly approvalIds: readonly string[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly external: boolean;
  readonly deletionSupported: boolean;
}

export interface DataGovernanceState {
  readonly sequence: number;
  readonly now: number;
  readonly policy: DataGovernancePolicy;
  readonly objects: Readonly<Record<string, GovernedObject>>;
  readonly holds: Readonly<Record<string, RetentionHold>>;
  readonly erasures: Readonly<Record<string, ErasureRequest>>;
  readonly receipts: Readonly<Record<string, PurgeReceipt>>;
  readonly approvals: Readonly<Record<string, DisclosureApproval>>;
  readonly manifests: Readonly<Record<string, DisclosureManifest>>;
}

export type GovernanceActor = Readonly<{
  id: string;
  role: 'ingress_gateway' | 'governance_kernel' | 'data_steward' | 'compliance' | 'privacy_operator' | 'storage_gateway' | 'disclosure_gateway';
}>;

export type GovernanceEvent = Readonly<{
  seq: number;
  type:
    | 'governance.created'
    | 'clock.advanced'
    | 'object.registered'
    | 'hold.placed'
    | 'hold.released'
    | 'erasure.requested'
    | 'purge.planned'
    | 'purge.receipt_recorded'
    | 'object.payload_purged'
    | 'disclosure.approval_recorded'
    | 'disclosure.manifest_recorded';
  actor: GovernanceActor;
  payload: Readonly<Record<string, unknown>>;
}>;

export type GovernanceCommand =
  | Readonly<{ type: 'advance_clock'; actor: GovernanceActor; ticks: number }>
  | Readonly<{ type: 'register_object'; actor: GovernanceActor; input: GovernedObjectInput }>
  | Readonly<{ type: 'place_hold'; actor: GovernanceActor; hold: Omit<RetentionHold, 'status'> }>
  | Readonly<{ type: 'release_hold'; actor: GovernanceActor; holdId: string }>
  | Readonly<{ type: 'request_erasure'; actor: GovernanceActor; request: ErasureRequest }>
  | Readonly<{ type: 'plan_lifecycle'; actor: GovernanceActor }>
  | Readonly<{
    type: 'record_purge_receipt'; actor: GovernanceActor; receipt: PurgeReceipt;
  }>
  | Readonly<{ type: 'record_disclosure_approval'; actor: GovernanceActor; approval: DisclosureApproval }>
  | Readonly<{ type: 'record_manifest'; actor: GovernanceActor; manifest: DisclosureManifest }>;

const CLASS_LEVEL: Readonly<Record<Confidentiality, number>> = {
  unknown: 5,
  public: 0,
  project_internal: 1,
  confidential: 2,
  restricted: 3,
};

export function compileGovernancePolicy(
  baseline: DataGovernancePolicy,
  profile: DataGovernancePolicy,
): DataGovernancePolicy {
  if (baseline.tenantId !== profile.tenantId || profile.revision < baseline.revision) {
    throw new Error('Governance Policy scope/revision mismatch');
  }
  const allowedRegions = intersection(baseline.allowedRegions, profile.allowedRegions);
  const allowedDestinationIds = intersection(baseline.allowedDestinationIds, profile.allowedDestinationIds);
  if (allowedRegions.length === 0) throw new Error('Governance Policy has no allowed region');
  const transformIds = profile.transformIds.filter((id) => baseline.transformIds.includes(id));
  if (transformIds.length !== profile.transformIds.length) throw new Error('Profile references an untrusted Transform');
  const retention = {} as Record<RetentionClass, RetentionWindow>;
  for (const key of Object.keys(baseline.retention) as RetentionClass[]) {
    const minimumTicks = Math.max(baseline.retention[key].minimumTicks, profile.retention[key].minimumTicks);
    const maximumTicks = Math.min(baseline.retention[key].maximumTicks, profile.retention[key].maximumTicks);
    if (minimumTicks > maximumTicks) throw new Error(`Retention window conflict: ${key}`);
    retention[key] = { minimumTicks, maximumTicks };
  }
  const categoryFloor: Record<string, Exclude<Confidentiality, 'unknown'>> = { ...baseline.categoryFloor };
  for (const [category, floor] of Object.entries(profile.categoryFloor)) {
    categoryFloor[category] = stricter(categoryFloor[category] ?? 'public', floor);
  }
  const kindFloor = {} as Record<DataKind, Exclude<Confidentiality, 'unknown'>>;
  for (const kind of Object.keys(baseline.kindFloor) as DataKind[]) {
    kindFloor[kind] = stricter(baseline.kindFloor[kind], profile.kindFloor[kind]);
  }
  const channelMaximum = {} as Record<DisclosureChannel, Exclude<Confidentiality, 'unknown'>>;
  for (const channel of Object.keys(baseline.channelMaximum) as DisclosureChannel[]) {
    channelMaximum[channel] = moreRestrictiveMaximum(baseline.channelMaximum[channel], profile.channelMaximum[channel]);
  }
  return Object.freeze({
    ...profile,
    allowedRegions,
    allowedDestinationIds,
    destinationCatalog: baseline.destinationCatalog,
    categoryFloor,
    kindFloor,
    channelMaximum,
    retention,
    transformIds,
    transformCatalog: baseline.transformCatalog,
    externalApprovalAtOrAbove: moreRestrictiveMaximum(
      baseline.externalApprovalAtOrAbove,
      profile.externalApprovalAtOrAbove,
    ),
    crossProjectExport: baseline.crossProjectExport && profile.crossProjectExport,
  });
}

export function initialGovernanceJournal(policy: DataGovernancePolicy): readonly GovernanceEvent[] {
  validatePolicy(policy);
  return [event(0, 'governance.created', { id: 'kernel:data-governance', role: 'governance_kernel' }, { policy })];
}

export function replayGovernance(journal: readonly GovernanceEvent[]): DataGovernanceState {
  const created = journal[0];
  if (!created || created.type !== 'governance.created') throw new Error('Governance Journal must begin with governance.created');
  let state: DataGovernanceState = {
    sequence: 0,
    now: 0,
    policy: created.payload.policy as unknown as DataGovernancePolicy,
    objects: {},
    holds: {},
    erasures: {},
    receipts: {},
    approvals: {},
    manifests: {},
  };
  for (const entry of journal) state = evolve(state, entry);
  return state;
}

export function dispatchGovernance(
  journal: readonly GovernanceEvent[],
  command: GovernanceCommand,
): readonly GovernanceEvent[] {
  const state = replayGovernance(journal);
  const additions = decide(state, command);
  return Object.freeze([
    ...journal,
    ...additions.map((entry, index) => ({ ...entry, seq: journal.length + index })),
  ]);
}

export function evaluateDisclosure(
  state: DataGovernanceState,
  request: DisclosureRequest,
): DisclosureDecision {
  const object = requireObject(state, request.objectId);
  const descriptor = object.descriptor;
  const digest = disclosureRequestDigest(descriptor, request);
  const hardDenials: string[] = [];
  const trustedDestination = state.policy.destinationCatalog[request.destination.id];
  if (object.status !== 'active') hardDenials.push(`payload_${object.status}`);
  if (descriptor.classification === 'unknown') hardDenials.push('classification_unknown');
  if (request.envelope.governancePolicyRevision !== state.policy.revision) hardDenials.push('governance_policy_stale');
  if (request.envelope.tenantId !== descriptor.tenantId || request.destination.tenantId !== descriptor.tenantId) hardDenials.push('tenant_boundary');
  if (!state.policy.allowedDestinationIds.includes(request.destination.id)) hardDenials.push('destination_not_admitted');
  if (!trustedDestination || JSON.stringify(trustedDestination) !== JSON.stringify(request.destination)) {
    hardDenials.push('destination_contract_mismatch');
  }
  if (!request.envelope.allowedPurposes.includes(request.purpose) || !descriptor.allowedPurposes.includes(request.purpose)) hardDenials.push('purpose_not_allowed');
  if (request.destination.processingRegions.length === 0) hardDenials.push('destination_region_unknown');
  if (!request.destination.processingRegions.every((region) => descriptor.allowedRegions.includes(region) && state.policy.allowedRegions.includes(region))) {
    hardDenials.push('residency_violation');
  }
  if (
    request.destination.external
    && descriptor.classification !== 'public'
    && !request.destination.noTraining
  ) hardDenials.push('processor_training_not_prohibited');
  if (descriptor.categories.includes('credential')) hardDenials.push('credential_requires_secret_capability_port');
  const crossProject = request.envelope.projectId !== descriptor.projectId
    || (request.destination.projectId !== undefined && request.destination.projectId !== descriptor.projectId);
  const sponsorPortfolio = request.channel === 'sponsor_projection'
    && request.envelope.portfolioProjectIds?.includes(descriptor.projectId) === true;
  if (crossProject && !sponsorPortfolio && !state.policy.crossProjectExport) hardDenials.push('project_boundary');
  for (const recipient of request.destination.recipients ?? []) {
    if (recipient.tenantId !== descriptor.tenantId) hardDenials.push('recipient_tenant_boundary');
    if (request.channel === 'workroom_projection' && recipient.projectId !== descriptor.projectId) hardDenials.push('recipient_project_boundary');
  }
  if (hardDenials.length > 0) return decision('deny', digest, hardDenials, state.policy);

  const recipientMaximum = (request.destination.recipients ?? []).reduce<Exclude<Confidentiality, 'unknown'>>(
    (maximum, recipient) => moreRestrictiveMaximum(maximum, recipient.clearance),
    'restricted',
  );
  const maximum = [
    state.policy.channelMaximum[request.channel],
    request.destination.maxClassification,
    request.envelope.clearance,
    recipientMaximum,
  ].reduce(moreRestrictiveMaximum);
  const blockedCategories = descriptor.categories.filter((category) => !request.destination.allowedCategories.includes(category));
  const tooSensitive = CLASS_LEVEL[descriptor.classification] > CLASS_LEVEL[maximum];
  if (blockedCategories.length > 0 || tooSensitive) {
    const transform = findTransform(
      state.policy,
      descriptor,
      request.channel,
      maximum,
      request.destination.allowedCategories,
    );
    if (transform) {
      return {
        ...decision('transform_required', digest, [
          ...(tooSensitive ? [`classification_above_${maximum}`] : []),
          ...(blockedCategories.length > 0 ? [`destination_blocks:${blockedCategories.join(',')}`] : []),
        ], state.policy),
        requiredTransformId: transform.id,
      };
    }
    if (request.channel === 'workroom_projection' || request.channel === 'sponsor_projection' || request.requestedMode === 'metadata_only') {
      return decision('allow_metadata_only', digest, ['body_withheld_by_disclosure_policy'], state.policy);
    }
    return decision('deny', digest, ['no_trusted_minimizing_transform'], state.policy);
  }

  const requiredRoles: DisclosureApproval['role'][] = [];
  if (crossProject && !sponsorPortfolio) requiredRoles.push('data_steward');
  if (
    request.destination.external
    && CLASS_LEVEL[descriptor.classification] >= CLASS_LEVEL[state.policy.externalApprovalAtOrAbove]
  ) requiredRoles.push('compliance');
  const uniqueRoles = [...new Set(requiredRoles)];
  const validApprovals = Object.values(state.approvals).filter((approval) => (
    approval.requestDigest === digest && approval.expiresAt > state.now && approval.decision === 'approved'
  ));
  const missing = uniqueRoles.filter((role) => !validApprovals.some((approval) => approval.role === role));
  if (missing.length > 0) {
    return { ...decision('approval_required', digest, ['exact_disclosure_approval_required'], state.policy), requiredApprovalRoles: missing };
  }
  return decision(
    request.requestedMode === 'metadata_only' ? 'allow_metadata_only' : 'allow_full',
    digest,
    request.destination.external ? ['authorized_external_disclosure'] : ['authorized_minimum_disclosure'],
    state.policy,
  );
}

export function materializeDisclosure(
  state: DataGovernanceState,
  request: DisclosureRequest,
  decisionValue: DisclosureDecision,
): Readonly<{ content: string; manifest: DisclosureManifest }> {
  const object = requireObject(state, request.objectId);
  const current = evaluateDisclosure(state, request);
  if (
    !['allow_full', 'allow_metadata_only'].includes(current.disposition)
    || current.disposition !== decisionValue.disposition
    || current.requestDigest !== decisionValue.requestDigest
  ) {
    throw new Error(`Disclosure is stale or ${current.disposition}`);
  }
  const content = decisionValue.disposition === 'allow_full'
    ? object.payload
    : JSON.stringify({ objectId: object.descriptor.objectId, kind: object.descriptor.kind, availability: 'body_withheld' });
  if (content === undefined) throw new Error('Payload is unavailable');
  const approvalIds = Object.values(state.approvals)
    .filter((approval) => approval.requestDigest === decisionValue.requestDigest && approval.expiresAt > state.now && approval.decision === 'approved')
    .map((approval) => approval.id);
  return {
    content,
    manifest: {
      id: `manifest:${request.objectId}:${decisionValue.requestDigest.slice(0, 12)}`,
      objectId: request.objectId,
      sourcePayloadHash: object.descriptor.payloadHash,
      disclosedContentHash: hash(content),
      requestDigest: decisionValue.requestDigest,
      channel: request.channel,
      purpose: request.purpose,
      destinationId: request.destination.id,
      destinationTrustDomain: request.destination.trustDomain,
      mode: decisionValue.disposition === 'allow_full' ? 'full' : 'metadata_only',
      policyRevision: state.policy.revision,
      approvalIds,
      issuedAt: state.now,
      expiresAt: state.now + 1,
      external: request.destination.external,
      deletionSupported: request.destination.supportsDeletion,
    },
  };
}

export function deriveUntrustedObject(
  sources: readonly GovernedObject[],
  input: Omit<GovernedObjectInput, 'proposedClassification' | 'categories' | 'allowedPurposes' | 'allowedRegions' | 'subjectRefs' | 'sourceObjectIds' | 'inheritedRetention' | 'subjectLinkage'>,
): GovernedObjectInput {
  if (sources.length === 0) throw new Error('A derivative needs source objects');
  assertSameScope(sources);
  const minimumRetainUntil = Math.max(...sources.map((source) => source.descriptor.minimumRetainUntil));
  const deleteAfter = Math.min(...sources.map((source) => source.descriptor.deleteAfter));
  if (minimumRetainUntil > deleteAfter) throw new Error('Source retention windows do not intersect');
  return {
    ...input,
    proposedClassification: sources.map((source) => source.descriptor.classification).reduce(stricter),
    categories: unique(sources.flatMap((source) => source.descriptor.categories)),
    allowedPurposes: intersectMany(sources.map((source) => source.descriptor.allowedPurposes)),
    allowedRegions: intersectMany(sources.map((source) => source.descriptor.allowedRegions)),
    subjectRefs: unique(sources.flatMap((source) => source.descriptor.subjectRefs)),
    sourceObjectIds: sources.map((source) => source.descriptor.objectId),
    inheritedRetention: { minimumRetainUntil, deleteAfter },
    subjectLinkage: 'linked',
  };
}

export function applyTrustedTransform(
  source: GovernedObject,
  transformId: TrustedTransformDeclaration['id'],
  outputId: string,
  now: number,
  policy: DataGovernancePolicy,
): GovernedObjectInput {
  if (source.status !== 'active' || source.payload === undefined) throw new Error('Transform source payload is unavailable');
  if (!policy.transformIds.includes(transformId)) throw new Error('Transform is not trusted by current policy');
  const declaration = policy.transformCatalog[transformId];
  if (!declaration || !declaration.inputCategoriesAny.some((category) => source.descriptor.categories.includes(category))) {
    throw new Error('Transform does not apply to this object');
  }
  const payload = runTransform(transformId, source.payload);
  return {
    id: outputId,
    tenantId: source.descriptor.tenantId,
    projectId: source.descriptor.projectId,
    kind: source.descriptor.kind === 'source_message' ? 'workroom_fact' : source.descriptor.kind,
    payload,
    proposedClassification: declaration.outputClassification,
    categories: declaration.outputCategories,
    allowedPurposes: source.descriptor.allowedPurposes,
    allowedRegions: source.descriptor.allowedRegions,
    retentionClass: source.descriptor.retentionClass,
    subjectRefs: declaration.breaksSubjectLink ? [] : source.descriptor.subjectRefs,
    locations: ['payload-vault:primary'],
    sourceObjectIds: [source.descriptor.objectId],
    transformRef: transformId,
    inheritedRetention: {
      minimumRetainUntil: source.descriptor.minimumRetainUntil,
      deleteAfter: source.descriptor.deleteAfter,
    },
    subjectLinkage: declaration.breaksSubjectLink ? 'deidentified' : 'linked',
  };
}

export function disclosureRequestDigest(descriptor: DataDescriptor, request: DisclosureRequest): string {
  return hash(JSON.stringify({
    objectId: descriptor.objectId,
    payloadHash: descriptor.payloadHash,
    channel: request.channel,
    purpose: request.purpose,
    principal: request.envelope.principalId,
    envelopeProject: request.envelope.projectId,
    destination: request.destination.id,
    destinationContractDigest: request.destination.contractDigest,
    destinationProject: request.destination.projectId ?? null,
    destinationRegions: [...request.destination.processingRegions].sort(),
    membershipRevision: request.destination.membershipRevision ?? null,
    envelopeRole: request.envelope.role,
    assignmentId: request.envelope.assignmentId ?? null,
    clearance: request.envelope.clearance,
    requestedMode: request.requestedMode,
    policyRevision: request.envelope.governancePolicyRevision,
  }));
}

export function erasureStatus(
  state: DataGovernanceState,
  requestId: string,
): 'pending' | 'blocked_minimum_retention' | 'blocked_by_hold' | 'purging' | 'reconciliation' | 'completed' | 'completed_with_recorded_external_disclosure' {
  const request = state.erasures[requestId];
  if (!request) throw new Error(`Unknown Erasure Request: ${requestId}`);
  const objects = subjectObjects(state, request.subjectRef);
  if (objects.some((object) => activeHolds(state, object.descriptor.objectId).length > 0)) return 'blocked_by_hold';
  if (objects.some((object) => state.now < object.descriptor.minimumRetainUntil)) return 'blocked_minimum_retention';
  if (objects.some((object) => Object.values(object.locations).includes('outcome_unknown'))) return 'reconciliation';
  if (objects.some((object) => object.status === 'purge_pending')) return 'purging';
  if (objects.every((object) => object.status === 'purged')) {
    const disclosedExternally = Object.values(state.manifests).some((manifest) => (
      manifest.external && objects.some((object) => object.descriptor.objectId === manifest.objectId)
    ));
    return disclosedExternally ? 'completed_with_recorded_external_disclosure' : 'completed';
  }
  return 'pending';
}

function decide(state: DataGovernanceState, command: GovernanceCommand): readonly Omit<GovernanceEvent, 'seq'>[] {
  switch (command.type) {
    case 'advance_clock':
      requireRole(command.actor, 'governance_kernel');
      if (!Number.isInteger(command.ticks) || command.ticks <= 0) throw new Error('ticks must be positive');
      return [domainEvent('clock.advanced', command.actor, { now: state.now + command.ticks })];
    case 'register_object': {
      requireRole(command.actor, 'ingress_gateway');
      const prepared = prepareObject(command.input, state.policy, state.now);
      const existing = state.objects[prepared.descriptor.objectId];
      if (existing) {
        if (existing.descriptor.payloadHash !== prepared.descriptor.payloadHash) throw new Error(`Data Object id conflict: ${prepared.descriptor.objectId}`);
        return [];
      }
      for (const sourceId of prepared.descriptor.sourceObjectIds) requireObject(state, sourceId);
      return [domainEvent('object.registered', command.actor, { object: prepared })];
    }
    case 'place_hold': {
      requireRole(command.actor, 'data_steward');
      requireObject(state, command.hold.objectId);
      if (command.hold.reviewAt <= state.now) throw new Error('Retention Hold requires a future reviewAt');
      const existing = state.holds[command.hold.id];
      if (existing) return [];
      return [domainEvent('hold.placed', command.actor, { hold: { ...command.hold, status: 'active' } })];
    }
    case 'release_hold': {
      requireRole(command.actor, 'data_steward');
      const hold = state.holds[command.holdId];
      if (!hold) throw new Error(`Unknown Retention Hold: ${command.holdId}`);
      if (hold.status === 'released') return [];
      return [domainEvent('hold.released', command.actor, { holdId: hold.id })];
    }
    case 'request_erasure': {
      requireRole(command.actor, 'privacy_operator');
      if (state.erasures[command.request.id]) return [];
      return [domainEvent('erasure.requested', command.actor, { request: command.request })];
    }
    case 'plan_lifecycle': {
      requireRole(command.actor, 'governance_kernel');
      const erasureSubjects = new Set(Object.values(state.erasures).map((request) => request.subjectRef));
      const events: Omit<GovernanceEvent, 'seq'>[] = [];
      for (const object of Object.values(state.objects)) {
        if (object.status !== 'active' && object.status !== 'quarantined') continue;
        const due = state.now >= object.descriptor.deleteAfter;
        const erased = object.descriptor.subjectLinkage === 'linked'
          && object.descriptor.subjectRefs.some((subject) => erasureSubjects.has(subject));
        if (!due && !erased) continue;
        if (state.now < object.descriptor.minimumRetainUntil || activeHolds(state, object.descriptor.objectId).length > 0) continue;
        events.push(domainEvent('purge.planned', command.actor, { objectId: object.descriptor.objectId }));
      }
      return events;
    }
    case 'record_purge_receipt': {
      requireRole(command.actor, 'storage_gateway');
      const object = requireObject(state, command.receipt.objectId);
      if (object.status !== 'purge_pending') throw new Error('Object has no active Purge Plan');
      if (!(command.receipt.location in object.locations)) throw new Error('Purge Receipt location is not in the object manifest');
      const existing = state.receipts[command.receipt.id];
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(command.receipt)) throw new Error(`Purge Receipt id conflict: ${command.receipt.id}`);
        return [];
      }
      const events: Omit<GovernanceEvent, 'seq'>[] = [domainEvent('purge.receipt_recorded', command.actor, { receipt: command.receipt })];
      const resultingLocations = { ...object.locations, [command.receipt.location]: command.receipt.outcome };
      if (Object.values(resultingLocations).every((status) => status === 'purged')) {
        events.push(domainEvent('object.payload_purged', command.actor, { objectId: object.descriptor.objectId }));
      }
      return events;
    }
    case 'record_disclosure_approval': {
      if (command.actor.role !== command.approval.role) throw new Error(`${command.approval.role} authority required`);
      if (command.approval.expiresAt <= state.now) throw new Error('Disclosure Approval must expire in the future');
      const existing = state.approvals[command.approval.id];
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(command.approval)) throw new Error(`Disclosure Approval id conflict: ${command.approval.id}`);
        return [];
      }
      return [domainEvent('disclosure.approval_recorded', command.actor, { approval: command.approval })];
    }
    case 'record_manifest': {
      requireRole(command.actor, 'disclosure_gateway');
      const object = requireObject(state, command.manifest.objectId);
      if (command.manifest.sourcePayloadHash !== object.descriptor.payloadHash || command.manifest.policyRevision !== state.policy.revision) {
        throw new Error('Disclosure Manifest does not bind the current object/policy');
      }
      const existing = state.manifests[command.manifest.id];
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(command.manifest)) throw new Error(`Disclosure Manifest id conflict: ${command.manifest.id}`);
        return [];
      }
      return [domainEvent('disclosure.manifest_recorded', command.actor, { manifest: command.manifest })];
    }
  }
}

function prepareObject(input: GovernedObjectInput, policy: DataGovernancePolicy, now: number): GovernedObject {
  if (input.tenantId !== policy.tenantId || input.projectId !== policy.projectId) throw new Error('Data Object policy scope mismatch');
  if (input.allowedRegions.length === 0 || !input.allowedRegions.every((region) => policy.allowedRegions.includes(region))) {
    throw new Error('Data Object residency is outside policy');
  }
  if (input.locations.length === 0) throw new Error('Data Object requires a Payload Vault location manifest');
  let classification = input.proposedClassification;
  if (classification !== 'unknown') {
    classification = stricter(classification, policy.kindFloor[input.kind]);
    for (const category of input.categories) classification = stricter(classification, policy.categoryFloor[category] ?? 'public');
  }
  const window = policy.retention[input.retentionClass];
  let minimumRetainUntil = now + window.minimumTicks;
  let deleteAfter = now + window.maximumTicks;
  if (input.inheritedRetention) {
    minimumRetainUntil = Math.max(minimumRetainUntil, input.inheritedRetention.minimumRetainUntil);
    deleteAfter = Math.min(deleteAfter, input.inheritedRetention.deleteAfter);
  }
  if (minimumRetainUntil > deleteAfter) throw new Error('Data Object retention window is empty');
  const descriptor: DataDescriptor = {
    objectId: input.id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    kind: input.kind,
    payloadHash: hash(input.payload),
    classification,
    categories: unique(input.categories),
    allowedPurposes: unique(input.allowedPurposes),
    allowedRegions: unique(input.allowedRegions),
    retentionClass: input.retentionClass,
    subjectRefs: unique(input.subjectRefs),
    subjectLinkage: input.subjectLinkage ?? 'linked',
    sourceObjectIds: unique(input.sourceObjectIds ?? []),
    ...(input.transformRef ? { transformRef: input.transformRef } : {}),
    createdAt: now,
    minimumRetainUntil,
    deleteAfter,
    classificationPolicyRevision: policy.revision,
  };
  return {
    descriptor,
    payload: input.payload,
    status: classification === 'unknown' ? 'quarantined' : 'active',
    locations: Object.fromEntries(unique(input.locations).map((location) => [location, 'active'])),
  };
}

function evolve(state: DataGovernanceState, entry: GovernanceEvent): DataGovernanceState {
  let next = { ...state, sequence: entry.seq };
  switch (entry.type) {
    case 'governance.created': return next;
    case 'clock.advanced': return { ...next, now: Number(entry.payload.now) };
    case 'object.registered': {
      const object = entry.payload.object as unknown as GovernedObject;
      return { ...next, objects: { ...next.objects, [object.descriptor.objectId]: object } };
    }
    case 'hold.placed': {
      const hold = entry.payload.hold as unknown as RetentionHold;
      return { ...next, holds: { ...next.holds, [hold.id]: hold } };
    }
    case 'hold.released': {
      const id = String(entry.payload.holdId);
      const hold = next.holds[id]!;
      return { ...next, holds: { ...next.holds, [id]: { ...hold, status: 'released' } } };
    }
    case 'erasure.requested': {
      const request = entry.payload.request as unknown as ErasureRequest;
      return { ...next, erasures: { ...next.erasures, [request.id]: request } };
    }
    case 'purge.planned': {
      const id = String(entry.payload.objectId);
      const object = next.objects[id]!;
      return updateObject(next, id, {
        status: 'purge_pending',
        locations: Object.fromEntries(Object.keys(object.locations).map((location) => [location, 'purge_pending'])),
      });
    }
    case 'purge.receipt_recorded': {
      const receipt = entry.payload.receipt as unknown as PurgeReceipt;
      const object = next.objects[receipt.objectId]!;
      next = { ...next, receipts: { ...next.receipts, [receipt.id]: receipt } };
      return updateObject(next, receipt.objectId, {
        locations: { ...object.locations, [receipt.location]: receipt.outcome },
      });
    }
    case 'object.payload_purged': {
      const id = String(entry.payload.objectId);
      return updateObject(next, id, { status: 'purged' });
    }
    case 'disclosure.approval_recorded': {
      const approval = entry.payload.approval as unknown as DisclosureApproval;
      return { ...next, approvals: { ...next.approvals, [approval.id]: approval } };
    }
    case 'disclosure.manifest_recorded': {
      const manifest = entry.payload.manifest as unknown as DisclosureManifest;
      return { ...next, manifests: { ...next.manifests, [manifest.id]: manifest } };
    }
  }
}

function updateObject(state: DataGovernanceState, id: string, patch: Partial<GovernedObject>): DataGovernanceState {
  const object = state.objects[id];
  if (!object) throw new Error(`Unknown Data Object: ${id}`);
  const merged = { ...object, ...patch };
  if (patch.status === 'purged') delete (merged as { payload?: string }).payload;
  return { ...state, objects: { ...state.objects, [id]: merged } };
}

function findTransform(
  policy: DataGovernancePolicy,
  descriptor: DataDescriptor,
  channel: DisclosureChannel,
  maximum?: Exclude<Confidentiality, 'unknown'>,
  allowedCategories?: readonly string[],
): TrustedTransformDeclaration | undefined {
  return policy.transformIds
    .map((id) => policy.transformCatalog[id])
    .find((item) => item?.allowedChannels.includes(channel)
      && item.inputCategoriesAny.some((category) => descriptor.categories.includes(category))
      && (maximum === undefined || CLASS_LEVEL[item.outputClassification] <= CLASS_LEVEL[maximum])
      && (allowedCategories === undefined || item.outputCategories.every((category) => allowedCategories.includes(category))));
}

function runTransform(id: TrustedTransformDeclaration['id'], payload: string): string {
  switch (id) {
    case 'support.case-redact:v1':
      return payload
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email-redacted]')
        .replace(/ORD-[A-Z0-9-]+/giu, 'ORD-[redacted]');
    case 'support.status:v1':
      return 'A customer support case is under diagnosis; customer details are withheld.';
    case 'investment.aggregate:v1': {
      const parsed = JSON.parse(payload) as { positions: Array<{ sector: string; value: number }> };
      const totals: Record<string, number> = {};
      for (const position of parsed.positions) totals[position.sector] = (totals[position.sector] ?? 0) + position.value;
      return JSON.stringify({ sectorTotals: totals });
    }
    case 'investment.status:v1':
      return 'Portfolio risk analysis is in progress; positions and account details are withheld.';
  }
}

function decision(
  disposition: DisclosureDisposition,
  requestDigest: string,
  reasons: readonly string[],
  policy: DataGovernancePolicy,
): DisclosureDecision {
  return { disposition, requestDigest, reasons, requiredApprovalRoles: [], policyRevision: policy.revision };
}

function subjectObjects(state: DataGovernanceState, subjectRef: string): readonly GovernedObject[] {
  const direct = new Set(Object.values(state.objects)
    .filter((object) => object.descriptor.subjectLinkage === 'linked' && object.descriptor.subjectRefs.includes(subjectRef))
    .map((object) => object.descriptor.objectId));
  let changed = true;
  while (changed) {
    changed = false;
    for (const object of Object.values(state.objects)) {
      if (object.descriptor.subjectLinkage === 'linked' && object.descriptor.sourceObjectIds.some((id) => direct.has(id)) && !direct.has(object.descriptor.objectId)) {
        direct.add(object.descriptor.objectId);
        changed = true;
      }
    }
  }
  return [...direct].map((id) => state.objects[id]!);
}

function activeHolds(state: DataGovernanceState, objectId: string): readonly RetentionHold[] {
  return Object.values(state.holds).filter((hold) => hold.objectId === objectId && hold.status === 'active');
}

function requireObject(state: DataGovernanceState, id: string): GovernedObject {
  const object = state.objects[id];
  if (!object) throw new Error(`Unknown Data Object: ${id}`);
  return object;
}

function requireRole(actor: GovernanceActor, role: GovernanceActor['role']): void {
  if (actor.role !== role) throw new Error(`${role} authority required`);
}

function validatePolicy(policy: DataGovernancePolicy): void {
  if (policy.revision < 1 || policy.allowedRegions.length === 0) throw new Error('Invalid Governance Policy');
  for (const destinationId of policy.allowedDestinationIds) {
    if (!policy.destinationCatalog[destinationId]) throw new Error(`Missing trusted Processing Destination: ${destinationId}`);
  }
  for (const [key, value] of Object.entries(policy.retention)) {
    if (value.minimumTicks < 0 || value.maximumTicks < value.minimumTicks) throw new Error(`Invalid retention window: ${key}`);
  }
}

function assertSameScope(objects: readonly GovernedObject[]): void {
  const first = objects[0]!;
  if (objects.some((object) => object.descriptor.tenantId !== first.descriptor.tenantId || object.descriptor.projectId !== first.descriptor.projectId)) {
    throw new Error('Untrusted derivation cannot cross tenant/Project scope');
  }
}

function stricter<T extends Confidentiality>(left: T, right: T): T {
  return CLASS_LEVEL[left] >= CLASS_LEVEL[right] ? left : right;
}

function moreRestrictiveMaximum<T extends Exclude<Confidentiality, 'unknown'>>(left: T, right: T): T {
  return CLASS_LEVEL[left] <= CLASS_LEVEL[right] ? left : right;
}

function intersection<T>(left: readonly T[], right: readonly T[]): T[] {
  return left.filter((item) => right.includes(item));
}

function intersectMany<T>(lists: readonly (readonly T[])[]): T[] {
  return lists.slice(1).reduce<T[]>((result, list) => intersection(result, list), [...(lists[0] ?? [])]);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function domainEvent(
  type: GovernanceEvent['type'],
  actor: GovernanceActor,
  payload: Readonly<Record<string, unknown>>,
): Omit<GovernanceEvent, 'seq'> {
  return { type, actor, payload };
}

function event(
  seq: number,
  type: GovernanceEvent['type'],
  actor: GovernanceActor,
  payload: Readonly<Record<string, unknown>>,
): GovernanceEvent {
  return { seq, type, actor, payload };
}
