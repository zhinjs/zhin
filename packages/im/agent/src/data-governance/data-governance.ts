import { createHash } from 'node:crypto';

export type ConfidentialityClass =
  | 'public'
  | 'project_internal'
  | 'confidential'
  | 'restricted'
  | 'unknown';

export type DataKind =
  | 'source_message'
  | 'workroom_fact'
  | 'context_digest'
  | 'task_report'
  | 'artifact'
  | 'evidence'
  | 'execution_trace'
  | 'projection_payload';

export type DisclosurePurpose =
  | 'orchestration'
  | 'task_execution'
  | 'acceptance_review'
  | 'workroom_awareness'
  | 'portfolio_oversight'
  | 'remote_execution'
  | 'audit'
  | 'reconciliation';

export type RetentionClass =
  | 'transient'
  | 'operational'
  | 'project_record'
  | 'regulated_record';

export type DisclosureChannel =
  | 'context_view'
  | 'evidence_port'
  | 'workroom_projection'
  | 'sponsor_projection'
  | 'console'
  | 'model_provider'
  | 'a2a';

export interface DataCategoryRule {
  readonly confidentialityFloor: Exclude<ConfidentialityClass, 'unknown'>;
}

export interface DataCategoryRegistrySnapshot {
  readonly id: string;
  readonly revision: number;
  readonly digest: string;
  readonly tenantId: string;
  readonly kindFloors: Readonly<Partial<Record<DataKind, Exclude<ConfidentialityClass, 'unknown'>>>>;
  readonly categories: Readonly<Record<string, DataCategoryRule>>;
}

export type DataCategoryRegistrySnapshotInput = Omit<DataCategoryRegistrySnapshot, 'digest'>;

export function createDataCategoryRegistrySnapshot(
  input: DataCategoryRegistrySnapshotInput,
): DataCategoryRegistrySnapshot {
  if (!isNonEmpty(input.id) || !isNonEmpty(input.tenantId)
    || !Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error('Data Category Registry identity is invalid');
  }
  const kindFloors = Object.fromEntries(Object.entries(input.kindFloors)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, floor]) => {
      if (!isMember(kind, DATA_KINDS) || !isMember(floor, DISCLOSABLE_CONFIDENTIALITY_CLASSES)) {
        throw new Error(`Data Category Registry kind floor is invalid: ${kind}`);
      }
      return [kind, floor];
    }));
  const categories = Object.fromEntries(Object.entries(input.categories)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, rule]) => {
      if (!isNonEmpty(category) || !isRecord(rule)
        || Object.keys(rule).some(key => key !== 'confidentialityFloor')
        || !isMember(rule.confidentialityFloor, DISCLOSABLE_CONFIDENTIALITY_CLASSES)) {
        throw new Error(`Data Category Registry category rule is invalid: ${category}`);
      }
      return [category, deepFreeze({ confidentialityFloor: rule.confidentialityFloor })];
    }));
  const projection = deepFreeze({
    id: input.id.trim(),
    revision: input.revision,
    tenantId: input.tenantId.trim(),
    kindFloors,
    categories,
  });
  return deepFreeze({ ...projection, digest: hashStable(projection) });
}

export function assertDataCategoryRegistrySnapshot(value: DataCategoryRegistrySnapshot): void {
  const { digest, ...input } = value;
  const canonical = createDataCategoryRegistrySnapshot(input);
  if (digest !== canonical.digest || stableSerialize(value) !== stableSerialize(canonical)) {
    throw new Error('Data Category Registry digest does not match its content');
  }
}

export interface DataDescriptorCandidate {
  readonly objectId: string;
  readonly payloadHash: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly kind: DataKind;
  readonly proposedConfidentiality: ConfidentialityClass;
  readonly categories: readonly string[];
  readonly allowedPurposes: readonly DisclosurePurpose[];
  readonly allowedRegions: readonly string[];
  readonly subjectRefs: readonly string[];
  readonly retention: Readonly<{
    class: RetentionClass;
    minimumRetainUntil: number;
    deleteAfter: number;
  }>;
  readonly lineage: Readonly<{
    sourceObjectIds: readonly string[];
    transformRef?: string;
  }>;
}

export interface DataDescriptor {
  readonly objectId: string;
  readonly payloadHash: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly kind: DataKind;
  readonly confidentiality: Exclude<ConfidentialityClass, 'unknown'>;
  readonly categories: readonly string[];
  readonly allowedPurposes: readonly DisclosurePurpose[];
  readonly allowedRegions: readonly string[];
  readonly subjectRefs: readonly string[];
  readonly retention: DataDescriptorCandidate['retention'];
  readonly lineage: DataDescriptorCandidate['lineage'];
  readonly classificationSource: Readonly<{
    categoryRegistryId: string;
    categoryRegistryRevision: number;
    categoryRegistryDigest: string;
  }>;
}

export interface DisclosureRecipientSnapshot {
  readonly principalId: string;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly clearance: Exclude<ConfidentialityClass, 'unknown'>;
}

export interface DisclosureRecipientSetSnapshot {
  readonly revision: number;
  readonly digest: string;
  readonly recipients: readonly DisclosureRecipientSnapshot[];
}

export function createDisclosureRecipientSetSnapshot(input: Readonly<{
  revision: number;
  recipients: readonly DisclosureRecipientSnapshot[];
}>): DisclosureRecipientSetSnapshot {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || !Array.isArray(input.recipients)
    || input.recipients.length === 0) {
    throw new Error('Disclosure recipient snapshot is invalid');
  }
  const recipients = input.recipients.map((recipient) => {
    if (!isNonEmpty(recipient.principalId) || !isNonEmpty(recipient.tenantId)
      || (recipient.projectId !== undefined && !isNonEmpty(recipient.projectId))
      || !isMember(recipient.clearance, DISCLOSABLE_CONFIDENTIALITY_CLASSES)) {
      throw new Error('Disclosure recipient is invalid');
    }
    return deepFreeze({
      principalId: recipient.principalId.trim(),
      tenantId: recipient.tenantId.trim(),
      ...(recipient.projectId === undefined ? {} : { projectId: recipient.projectId.trim() }),
      clearance: recipient.clearance,
    });
  }).sort((left, right) => left.principalId.localeCompare(right.principalId));
  if (new Set(recipients.map(({ principalId }) => principalId)).size !== recipients.length) {
    throw new Error('Disclosure recipient snapshot contains duplicate principal ids');
  }
  const projection = deepFreeze({ revision: input.revision, recipients });
  return deepFreeze({ ...projection, digest: hashStable(projection) });
}

export function assertDisclosureRecipientSetSnapshot(value: DisclosureRecipientSetSnapshot): void {
  const canonical = createDisclosureRecipientSetSnapshot({
    revision: value.revision,
    recipients: value.recipients,
  });
  if (value.digest !== canonical.digest || stableSerialize(value) !== stableSerialize(canonical)) {
    throw new Error('Disclosure recipient snapshot digest does not match its content');
  }
}

export interface ProcessingDestinationContract {
  readonly id: string;
  readonly contractDigest: string;
  readonly owner: string;
  readonly endpoint: string;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly trustDomain: string;
  readonly processingRegions: readonly string[];
  readonly maxConfidentiality: Exclude<ConfidentialityClass, 'unknown'>;
  readonly allowedCategories: readonly string[];
  readonly external: boolean;
  readonly noTraining: boolean;
  readonly loggingMode: 'disabled' | 'metadata_only' | 'full';
  readonly maximumRetentionSeconds: number;
  readonly allowsRedisclosure: boolean;
  readonly supportsDeletion: boolean;
  readonly recipientSnapshotRevision: number;
  readonly recipientSnapshotDigest: string;
}

export type ProcessingDestinationContractInput = Omit<
ProcessingDestinationContract,
'contractDigest'
>;

export function createProcessingDestinationContract(
  input: ProcessingDestinationContractInput,
): ProcessingDestinationContract {
  const projection = canonicalDestination(input);
  return deepFreeze({
    ...projection,
    contractDigest: hashStable(projection),
  });
}

export function assertProcessingDestinationContract(
  value: ProcessingDestinationContract,
): void {
  const { contractDigest, ...input } = value;
  const canonical = createProcessingDestinationContract(input);
  if (contractDigest !== canonical.contractDigest || stableSerialize(value) !== stableSerialize(canonical)) {
    throw new Error('Processing Destination contract digest does not match its content');
  }
}

export interface TrustedDisclosureTransform {
  readonly id: string;
  readonly inputCategoriesAny: readonly string[];
  readonly outputConfidentiality: Exclude<ConfidentialityClass, 'unknown'>;
  readonly outputCategories: readonly string[];
  readonly allowedChannels: readonly DisclosureChannel[];
}

export interface DataGovernancePolicySnapshot {
  readonly id: string;
  readonly revision: number;
  readonly digest: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly destinations: Readonly<Record<string, ProcessingDestinationContract>>;
  readonly channelCeilings: Readonly<Record<DisclosureChannel, Exclude<ConfidentialityClass, 'unknown'>>>;
  readonly transforms: Readonly<Record<string, TrustedDisclosureTransform>>;
  readonly externalApprovalFloor: Exclude<ConfidentialityClass, 'unknown'>;
}

export type DataGovernancePolicySnapshotInput = Omit<DataGovernancePolicySnapshot, 'digest'>;

export function createDataGovernancePolicySnapshot(
  input: DataGovernancePolicySnapshotInput,
): DataGovernancePolicySnapshot {
  const destinations = Object.fromEntries(Object.entries(input.destinations)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, destination]) => {
      assertProcessingDestinationContract(destination);
      if (id !== destination.id) throw new Error('Processing Destination catalog id mismatch');
      return [id, destination];
    }));
  const transforms = Object.fromEntries(Object.entries(input.transforms)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, transform]) => {
      if (id !== transform.id || !isNonEmpty(id)
        || !Array.isArray(transform.inputCategoriesAny)
        || transform.inputCategoriesAny.some(value => !isNonEmpty(value))
        || !Array.isArray(transform.outputCategories)
        || transform.outputCategories.some(value => !isNonEmpty(value))
        || !isMember(transform.outputConfidentiality, DISCLOSABLE_CONFIDENTIALITY_CLASSES)
        || !isMemberArray(transform.allowedChannels, DISCLOSURE_CHANNELS)) {
        throw new Error(`Invalid trusted disclosure transform ${id}`);
      }
      return [id, deepFreeze({
        id,
        inputCategoriesAny: uniqueSorted(transform.inputCategoriesAny),
        outputConfidentiality: transform.outputConfidentiality,
        outputCategories: uniqueSorted(transform.outputCategories),
        allowedChannels: uniqueSorted(transform.allowedChannels),
      })];
    }));
  if (!isNonEmpty(input.id) || !isNonEmpty(input.tenantId) || !isNonEmpty(input.projectId)) {
    throw new Error('Data Governance Policy identity must be non-empty');
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error('Data Governance Policy revision must be a positive safe integer');
  }
  const ceilingKeys = Object.keys(input.channelCeilings);
  if (ceilingKeys.length !== DISCLOSURE_CHANNELS.length
    || ceilingKeys.some(key => !isMember(key, DISCLOSURE_CHANNELS))
    || Object.values(input.channelCeilings)
      .some(value => !isMember(value, DISCLOSABLE_CONFIDENTIALITY_CLASSES))
    || !isMember(input.externalApprovalFloor, DISCLOSABLE_CONFIDENTIALITY_CLASSES)) {
    throw new Error('Data Governance Policy disclosure ceilings are invalid');
  }
  const projection = deepFreeze({
    id: input.id.trim(),
    revision: input.revision,
    tenantId: input.tenantId.trim(),
    projectId: input.projectId.trim(),
    destinations,
    channelCeilings: { ...input.channelCeilings },
    transforms,
    externalApprovalFloor: input.externalApprovalFloor,
  });
  return deepFreeze({ ...projection, digest: hashStable(projection) });
}

export function assertDataGovernancePolicySnapshot(value: DataGovernancePolicySnapshot): void {
  const { digest, ...input } = value;
  const canonical = createDataGovernancePolicySnapshot(input);
  if (digest !== canonical.digest || stableSerialize(value) !== stableSerialize(canonical)) {
    throw new Error('Data Governance Policy digest does not match its content');
  }
}

export interface DisclosurePrincipalSnapshot {
  readonly principalId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly role: 'orchestrator' | 'executor' | 'reviewer' | 'sponsor' | 'auditor' | 'projector';
  readonly clearance: Exclude<ConfidentialityClass, 'unknown'>;
  readonly allowedPurposes: readonly DisclosurePurpose[];
  readonly assignmentId?: string;
}

export interface DisclosureContext {
  readonly channel: DisclosureChannel;
  readonly purpose: DisclosurePurpose;
  readonly requestedMode: 'full' | 'metadata_only';
  readonly policyRevision: number;
  readonly principal: DisclosurePrincipalSnapshot;
  readonly destination: ProcessingDestinationContract;
  readonly recipients: DisclosureRecipientSetSnapshot;
}

export interface DisclosureApprovalSnapshot {
  readonly id: string;
  readonly requestDigest: string;
  readonly role: 'data_steward' | 'compliance';
  readonly principalId: string;
  readonly policyRevision: number;
  readonly decision: 'approved' | 'rejected';
  readonly expiresAt: number;
}

export type DisclosureDisposition =
  | 'full'
  | 'metadata_only'
  | 'transform_required'
  | 'approval_required'
  | 'deny';

export type DisclosureReasonCode =
  | 'authorized_minimum_disclosure'
  | 'policy_revision_mismatch'
  | 'principal_tenant_mismatch'
  | 'principal_project_mismatch'
  | 'purpose_not_allowed'
  | 'destination_unknown'
  | 'destination_contract_mismatch'
  | 'recipient_snapshot_mismatch'
  | 'recipient_tenant_mismatch'
  | 'recipient_project_mismatch'
  | 'metadata_only_requested'
  | 'classification_above_destination_ceiling'
  | 'destination_category_blocked'
  | 'trusted_transform_required'
  | 'exact_approval_required'
  | 'authorized_external_disclosure'
  | 'credential_requires_secret_capability_port'
  | 'destination_region_unknown'
  | 'residency_violation'
  | 'external_training_not_prohibited'
  | 'no_trusted_minimizing_transform'
  | 'body_withheld_by_disclosure_policy'
  | 'channel_policy_missing'
  | 'recipient_snapshot_empty'
  | 'destination_tenant_mismatch'
  | 'destination_project_mismatch'
  | 'payload_retention_expired';

export interface DisclosureDecision {
  readonly disposition: DisclosureDisposition;
  readonly requestDigest: string;
  readonly reasonCodes: readonly DisclosureReasonCode[];
  readonly policy: Readonly<{ revision: number; digest: string }>;
  readonly contextBinding: Readonly<{
    objectId: string;
    payloadHash: string;
    channel: DisclosureChannel;
    purpose: DisclosurePurpose;
    principalId: string;
    assignmentId?: string;
    destinationId: string;
    destinationContractDigest: string;
    recipientRevision: number;
    recipientDigest: string;
    recipients: readonly DisclosureRecipientSnapshot[];
    principalSnapshot: DisclosurePrincipalSnapshot;
    destinationSnapshot: ProcessingDestinationContract;
    recipientSnapshot: DisclosureContext['recipients'];
  }>;
  readonly requiredTransformId?: string;
  readonly requiredApprovalRoles: readonly DisclosureApprovalSnapshot['role'][];
  readonly approvalIds: readonly string[];
}

export interface DisclosureDecisionInput {
  readonly descriptor: DataDescriptor;
  readonly policy: DataGovernancePolicySnapshot;
  readonly context: DisclosureContext;
  readonly approvals: readonly DisclosureApprovalSnapshot[];
  readonly evaluatedAt: number;
}

export type DataDescriptorQuarantineReason =
  | 'classification_unknown'
  | 'category_unknown'
  | 'registry_tenant_mismatch'
  | 'kind_floor_missing'
  | 'descriptor_malformed'
  | 'retention_window_invalid';

export type DataDescriptorClassification =
  | Readonly<{
    status: 'quarantined';
    objectId: string;
    categoryRegistryRevision: number;
    reasonCodes: readonly DataDescriptorQuarantineReason[];
  }>
  | Readonly<{
    status: 'registered';
    descriptor: DataDescriptor;
  }>;

export function classifyDataDescriptor(
  candidateInput: unknown,
  registry: DataCategoryRegistrySnapshot,
): DataDescriptorClassification {
  if (!isDataDescriptorCandidate(candidateInput)) {
    return deepFreeze({
      status: 'quarantined',
      objectId: candidateObjectId(candidateInput),
      categoryRegistryRevision: registry.revision,
      reasonCodes: ['descriptor_malformed'],
    });
  }
  const candidate = candidateInput;
  const reasonCodes: DataDescriptorQuarantineReason[] = [];
  const proposedConfidentiality = candidate.proposedConfidentiality;
  if (proposedConfidentiality === 'unknown') reasonCodes.push('classification_unknown');
  if (candidate.categories.some((category) => registry.categories[category] === undefined)) {
    reasonCodes.push('category_unknown');
  }
  if (candidate.tenantId !== registry.tenantId) reasonCodes.push('registry_tenant_mismatch');
  if (registry.kindFloors[candidate.kind] === undefined) reasonCodes.push('kind_floor_missing');
  if (
    !isNonEmpty(candidate.objectId)
    || !/^sha256:[a-f\d]{64}$/u.test(candidate.payloadHash)
    || !isNonEmpty(candidate.tenantId)
    || !isNonEmpty(candidate.projectId)
    || candidate.allowedPurposes.length === 0
    || candidate.allowedRegions.length === 0
  ) {
    reasonCodes.push('descriptor_malformed');
  }
  if (
    !Number.isSafeInteger(candidate.retention.minimumRetainUntil)
    || !Number.isSafeInteger(candidate.retention.deleteAfter)
    || candidate.retention.minimumRetainUntil < 0
    || candidate.retention.minimumRetainUntil > candidate.retention.deleteAfter
  ) {
    reasonCodes.push('retention_window_invalid');
  }
  if (reasonCodes.length > 0) {
    return deepFreeze({
      status: 'quarantined',
      objectId: candidate.objectId.trim(),
      categoryRegistryRevision: registry.revision,
      reasonCodes,
    });
  }
  const categoryFloors = candidate.categories.map((category) => (
    registry.categories[category]?.confidentialityFloor ?? 'restricted'
  ));
  if (proposedConfidentiality === 'unknown') throw new Error('unreachable quarantined classification');
  const floors: Exclude<ConfidentialityClass, 'unknown'>[] = [
    proposedConfidentiality,
    registry.kindFloors[candidate.kind] ?? 'restricted',
    ...categoryFloors,
  ];
  const confidentiality = floors.reduce(stricterConfidentiality, 'public');
  return deepFreeze({
    status: 'registered',
    descriptor: {
      objectId: candidate.objectId,
      payloadHash: candidate.payloadHash,
      tenantId: candidate.tenantId,
      projectId: candidate.projectId,
      kind: candidate.kind,
      confidentiality,
      categories: uniqueSorted(candidate.categories),
      allowedPurposes: uniqueSorted(candidate.allowedPurposes),
      allowedRegions: uniqueSorted(candidate.allowedRegions),
      subjectRefs: uniqueSorted(candidate.subjectRefs),
      retention: { ...candidate.retention },
      lineage: {
        ...candidate.lineage,
        sourceObjectIds: uniqueSorted(candidate.lineage.sourceObjectIds),
      },
      classificationSource: {
        categoryRegistryId: registry.id,
        categoryRegistryRevision: registry.revision,
        categoryRegistryDigest: registry.digest,
      },
    },
  });
}

/** Re-validates a registered Descriptor against the trusted generation registry used at ingress. */
export function assertRegisteredDataDescriptor(
  descriptor: DataDescriptor,
  registry: DataCategoryRegistrySnapshot,
): void {
  assertDataCategoryRegistrySnapshot(registry);
  if (!isRecord(descriptor)
    || !isMember(descriptor.kind, DATA_KINDS)
    || !isMember(descriptor.confidentiality, DISCLOSABLE_CONFIDENTIALITY_CLASSES)
    || !isStringArray(descriptor.categories)
    || !isMemberArray(descriptor.allowedPurposes, DISCLOSURE_PURPOSES)
    || !isStringArray(descriptor.allowedRegions)
    || !isStringArray(descriptor.subjectRefs)
    || !isRecord(descriptor.retention)
    || !isMember(descriptor.retention.class, RETENTION_CLASSES)
    || !isRecord(descriptor.lineage)
    || !isStringArray(descriptor.lineage.sourceObjectIds)
    || (descriptor.lineage.transformRef !== undefined
      && typeof descriptor.lineage.transformRef !== 'string')
    || !isRecord(descriptor.classificationSource)) {
    throw new Error('Data Descriptor registered snapshot is malformed or non-canonical');
  }
  if (descriptor.classificationSource.categoryRegistryId !== registry.id
    || descriptor.classificationSource.categoryRegistryRevision !== registry.revision
    || descriptor.classificationSource.categoryRegistryDigest !== registry.digest
    || descriptor.tenantId !== registry.tenantId) {
    throw new Error('Data Descriptor registry proof does not match the trusted registry');
  }
  const kindFloor = registry.kindFloors[descriptor.kind];
  const categoryFloors = descriptor.categories.map(category => registry.categories[category]?.confidentialityFloor);
  if (!kindFloor || categoryFloors.some(floor => floor === undefined)) {
    throw new Error('Data Descriptor references an unknown trusted floor');
  }
  const trustedFloor = [kindFloor, ...categoryFloors.filter((floor): floor is Exclude<
  ConfidentialityClass, 'unknown'> => floor !== undefined)]
    .reduce(stricterConfidentiality, 'public');
  if (CONFIDENTIALITY_LEVEL[descriptor.confidentiality] < CONFIDENTIALITY_LEVEL[trustedFloor]) {
    throw new Error('Data Descriptor confidentiality is below its trusted floor');
  }
  if (!isNonEmpty(descriptor.objectId) || !/^sha256:[a-f\d]{64}$/u.test(descriptor.payloadHash)
    || !isNonEmpty(descriptor.projectId)
    || descriptor.allowedPurposes.length === 0 || descriptor.allowedRegions.length === 0
    || stableSerialize(descriptor.categories) !== stableSerialize(uniqueSorted(descriptor.categories))
    || stableSerialize(descriptor.allowedPurposes) !== stableSerialize(uniqueSorted(descriptor.allowedPurposes))
    || stableSerialize(descriptor.allowedRegions) !== stableSerialize(uniqueSorted(descriptor.allowedRegions))
    || stableSerialize(descriptor.subjectRefs) !== stableSerialize(uniqueSorted(descriptor.subjectRefs))
    || stableSerialize(descriptor.lineage.sourceObjectIds)
      !== stableSerialize(uniqueSorted(descriptor.lineage.sourceObjectIds))
    || !Number.isSafeInteger(descriptor.retention.minimumRetainUntil)
    || !Number.isSafeInteger(descriptor.retention.deleteAfter)
    || descriptor.retention.minimumRetainUntil < 0
    || descriptor.retention.minimumRetainUntil > descriptor.retention.deleteAfter) {
    throw new Error('Data Descriptor registered snapshot is malformed or non-canonical');
  }
}

const DATA_KINDS: readonly DataKind[] = [
  'source_message',
  'workroom_fact',
  'context_digest',
  'task_report',
  'artifact',
  'evidence',
  'execution_trace',
  'projection_payload',
];

const CONFIDENTIALITY_CLASSES: readonly ConfidentialityClass[] = [
  'public',
  'project_internal',
  'confidential',
  'restricted',
  'unknown',
];

const DISCLOSABLE_CONFIDENTIALITY_CLASSES: readonly Exclude<ConfidentialityClass, 'unknown'>[] = [
  'public',
  'project_internal',
  'confidential',
  'restricted',
];

const DISCLOSURE_PURPOSES: readonly DisclosurePurpose[] = [
  'orchestration',
  'task_execution',
  'acceptance_review',
  'workroom_awareness',
  'portfolio_oversight',
  'remote_execution',
  'audit',
  'reconciliation',
];

const DISCLOSURE_CHANNELS: readonly DisclosureChannel[] = [
  'context_view',
  'evidence_port',
  'workroom_projection',
  'sponsor_projection',
  'console',
  'model_provider',
  'a2a',
];

const RETENTION_CLASSES: readonly RetentionClass[] = [
  'transient',
  'operational',
  'project_record',
  'regulated_record',
];

function isDataDescriptorCandidate(value: unknown): value is DataDescriptorCandidate {
  if (!isRecord(value)) return false;
  if (
    typeof value.objectId !== 'string'
    || typeof value.payloadHash !== 'string'
    || typeof value.tenantId !== 'string'
    || typeof value.projectId !== 'string'
    || !isMember(value.kind, DATA_KINDS)
    || !isMember(value.proposedConfidentiality, CONFIDENTIALITY_CLASSES)
    || !isStringArray(value.categories)
    || !isMemberArray(value.allowedPurposes, DISCLOSURE_PURPOSES)
    || !isStringArray(value.allowedRegions)
    || !isStringArray(value.subjectRefs)
    || !isRecord(value.retention)
    || !isMember(value.retention.class, RETENTION_CLASSES)
    || typeof value.retention.minimumRetainUntil !== 'number'
    || typeof value.retention.deleteAfter !== 'number'
    || !isRecord(value.lineage)
    || !isStringArray(value.lineage.sourceObjectIds)
  ) {
    return false;
  }
  return value.lineage.transformRef === undefined || typeof value.lineage.transformRef === 'string';
}

function candidateObjectId(value: unknown): string {
  return isRecord(value) && typeof value.objectId === 'string' ? value.objectId.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isMember<T extends string>(value: unknown, members: readonly T[]): value is T {
  return typeof value === 'string' && members.includes(value as T);
}

function isMemberArray<T extends string>(value: unknown, members: readonly T[]): value is T[] {
  return Array.isArray(value) && value.every((item) => isMember(item, members));
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function canonicalDestination(
  input: ProcessingDestinationContractInput,
): ProcessingDestinationContractInput {
  const requiredStrings = [
    input.id,
    input.owner,
    input.endpoint,
    input.tenantId,
    input.trustDomain,
  ];
  if (requiredStrings.some((value) => !isNonEmpty(value))) {
    throw new Error('Processing Destination identity must be non-empty');
  }
  if (input.projectId !== undefined && !isNonEmpty(input.projectId)) {
    throw new Error('Processing Destination project id must be non-empty when present');
  }
  if (!Array.isArray(input.processingRegions)
    || input.processingRegions.length === 0
    || input.processingRegions.some((value) => !isNonEmpty(value))) {
    throw new Error('Processing Destination regions must be non-empty');
  }
  if (!Array.isArray(input.allowedCategories)
    || input.allowedCategories.some((value) => !isNonEmpty(value))) {
    throw new Error('Processing Destination categories must be non-empty');
  }
  if (!isMember(input.maxConfidentiality, DISCLOSABLE_CONFIDENTIALITY_CLASSES)
    || !isMember(input.loggingMode, ['disabled', 'metadata_only', 'full'] as const)
    || typeof input.external !== 'boolean'
    || typeof input.noTraining !== 'boolean'
    || typeof input.allowsRedisclosure !== 'boolean'
    || typeof input.supportsDeletion !== 'boolean') {
    throw new Error('Processing Destination policy fields are invalid');
  }
  if (!Number.isSafeInteger(input.maximumRetentionSeconds) || input.maximumRetentionSeconds < 1) {
    throw new Error('Processing Destination maximum retention must be a positive safe integer');
  }
  if (!Number.isSafeInteger(input.recipientSnapshotRevision) || input.recipientSnapshotRevision < 1) {
    throw new Error('Processing Destination recipient revision must be a positive safe integer');
  }
  if (!/^sha256:[a-f\d]{64}$/u.test(input.recipientSnapshotDigest)) {
    throw new Error('Processing Destination recipient digest must be canonical SHA-256');
  }
  return deepFreeze({
    id: input.id.trim(),
    owner: input.owner.trim(),
    endpoint: input.endpoint.trim(),
    tenantId: input.tenantId.trim(),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId.trim() }),
    trustDomain: input.trustDomain.trim(),
    processingRegions: uniqueSorted(input.processingRegions.map((value) => value.trim())),
    maxConfidentiality: input.maxConfidentiality,
    allowedCategories: uniqueSorted(input.allowedCategories.map((value) => value.trim())),
    external: input.external,
    noTraining: input.noTraining,
    loggingMode: input.loggingMode,
    maximumRetentionSeconds: input.maximumRetentionSeconds,
    allowsRedisclosure: input.allowsRedisclosure,
    supportsDeletion: input.supportsDeletion,
    recipientSnapshotRevision: input.recipientSnapshotRevision,
    recipientSnapshotDigest: input.recipientSnapshotDigest,
  });
}

function hashStable(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}

export function decideDisclosure(input: DisclosureDecisionInput): DisclosureDecision {
  const requestDigest = disclosureRequestDigest(input.descriptor, input.context, input.policy);
  const hardDenials: DisclosureReasonCode[] = [];
  if (input.evaluatedAt >= input.descriptor.retention.deleteAfter) {
    hardDenials.push('payload_retention_expired');
  }
  if (input.policy.channelCeilings[input.context.channel] === undefined) {
    hardDenials.push('channel_policy_missing');
  }
  if (input.descriptor.categories.includes('credential')) {
    hardDenials.push('credential_requires_secret_capability_port');
  }
  if (input.context.destination.processingRegions.length === 0) {
    hardDenials.push('destination_region_unknown');
  } else if (input.context.destination.processingRegions.some((region) => (
    !input.descriptor.allowedRegions.includes(region)
  ))) {
    hardDenials.push('residency_violation');
  }
  if (
    input.context.destination.external
    && input.descriptor.confidentiality !== 'public'
    && !input.context.destination.noTraining
  ) {
    hardDenials.push('external_training_not_prohibited');
  }
  if (input.context.destination.tenantId !== input.descriptor.tenantId) {
    hardDenials.push('destination_tenant_mismatch');
  }
  if (
    input.context.destination.projectId !== undefined
    && input.context.destination.projectId !== input.descriptor.projectId
  ) {
    hardDenials.push('destination_project_mismatch');
  }
  if (input.context.policyRevision !== input.policy.revision) {
    hardDenials.push('policy_revision_mismatch');
  }
  if (
    input.context.principal.tenantId !== input.descriptor.tenantId
    || input.context.principal.tenantId !== input.policy.tenantId
  ) {
    hardDenials.push('principal_tenant_mismatch');
  }
  if (
    input.context.principal.projectId !== input.descriptor.projectId
    || input.context.principal.projectId !== input.policy.projectId
  ) {
    hardDenials.push('principal_project_mismatch');
  }
  if (
    !input.descriptor.allowedPurposes.includes(input.context.purpose)
    || !input.context.principal.allowedPurposes.includes(input.context.purpose)
  ) {
    hardDenials.push('purpose_not_allowed');
  }
  const trustedDestination = input.policy.destinations[input.context.destination.id];
  if (trustedDestination === undefined) {
    hardDenials.push('destination_unknown');
  } else if (stableSerialize(trustedDestination) !== stableSerialize(input.context.destination)) {
    hardDenials.push('destination_contract_mismatch');
  }
  if (
    input.context.recipients.revision !== input.context.destination.recipientSnapshotRevision
    || input.context.recipients.digest !== input.context.destination.recipientSnapshotDigest
  ) {
    hardDenials.push('recipient_snapshot_mismatch');
  }
  if (input.context.recipients.recipients.length === 0) {
    hardDenials.push('recipient_snapshot_empty');
  }
  if (input.context.recipients.recipients.some((recipient) => recipient.tenantId !== input.descriptor.tenantId)) {
    hardDenials.push('recipient_tenant_mismatch');
  }
  if (input.context.recipients.recipients.some((recipient) => (
    recipient.projectId !== undefined && recipient.projectId !== input.descriptor.projectId
  ))) {
    hardDenials.push('recipient_project_mismatch');
  }
  if (hardDenials.length > 0) {
    return disclosureDecision(input, requestDigest, 'deny', hardDenials);
  }
  const recipientCeiling = input.context.recipients.recipients
    .map((recipient) => recipient.clearance)
    .reduce(moreRestrictiveCeiling, 'restricted');
  const disclosureCeiling = [
    input.policy.channelCeilings[input.context.channel],
    input.context.destination.maxConfidentiality,
    input.context.principal.clearance,
    recipientCeiling,
  ].reduce(moreRestrictiveCeiling, 'restricted');
  const classificationBlocked = (
    CONFIDENTIALITY_LEVEL[input.descriptor.confidentiality]
    > CONFIDENTIALITY_LEVEL[disclosureCeiling]
  );
  const categoriesBlocked = input.descriptor.categories.some((category) => (
    !input.context.destination.allowedCategories.includes(category)
  ));
  if (classificationBlocked || categoriesBlocked) {
    const transform = Object.values(input.policy.transforms)
      .sort((left, right) => left.id.localeCompare(right.id))
      .find((candidate) => (
        candidate.allowedChannels.includes(input.context.channel)
        && candidate.inputCategoriesAny.some((category) => input.descriptor.categories.includes(category))
        && CONFIDENTIALITY_LEVEL[candidate.outputConfidentiality] <= CONFIDENTIALITY_LEVEL[disclosureCeiling]
        && candidate.outputCategories.every((category) => (
          input.context.destination.allowedCategories.includes(category)
        ))
      ));
    if (transform !== undefined) {
      return disclosureDecision(input, requestDigest, 'transform_required', [
        ...(classificationBlocked ? ['classification_above_destination_ceiling' as const] : []),
        ...(categoriesBlocked ? ['destination_category_blocked' as const] : []),
        'trusted_transform_required',
      ], { requiredTransformId: transform.id });
    }
    const blockedReasons: DisclosureReasonCode[] = [
      ...(classificationBlocked ? ['classification_above_destination_ceiling' as const] : []),
      ...(categoriesBlocked ? ['destination_category_blocked' as const] : []),
    ];
    if (input.context.requestedMode === 'metadata_only') {
      return disclosureDecision(input, requestDigest, 'metadata_only', [
        ...blockedReasons,
        'body_withheld_by_disclosure_policy',
      ]);
    }
    return disclosureDecision(input, requestDigest, 'deny', [
      ...blockedReasons,
      'no_trusted_minimizing_transform',
    ]);
  }
  const approvalRoles: DisclosureApprovalSnapshot['role'][] = [];
  if (
    input.context.destination.external
    && CONFIDENTIALITY_LEVEL[input.descriptor.confidentiality]
      >= CONFIDENTIALITY_LEVEL[input.policy.externalApprovalFloor]
  ) {
    approvalRoles.push('compliance');
  }
  const missingApprovalRoles = approvalRoles.filter((role) => (
    !input.approvals.some((approval) => (
      approval.requestDigest === requestDigest
      && approval.role === role
      && approval.policyRevision === input.policy.revision
      && approval.decision === 'approved'
      && approval.expiresAt > input.evaluatedAt
    ))
  ));
  if (missingApprovalRoles.length > 0) {
    return disclosureDecision(
      input,
      requestDigest,
      'approval_required',
      ['exact_approval_required'],
      { requiredApprovalRoles: missingApprovalRoles },
    );
  }
  if (input.context.requestedMode === 'metadata_only') {
    return disclosureDecision(input, requestDigest, 'metadata_only', ['metadata_only_requested'], {
      approvalIds: approvalRoles.map((role) => input.approvals.find((approval) => (
        approval.requestDigest === requestDigest && approval.role === role
        && approval.policyRevision === input.policy.revision && approval.decision === 'approved'
        && approval.expiresAt > input.evaluatedAt
      ))!.id),
    });
  }
  return disclosureDecision(
    input,
    requestDigest,
    'full',
    [input.context.destination.external
      ? 'authorized_external_disclosure'
      : 'authorized_minimum_disclosure'],
    {
      approvalIds: approvalRoles.map((role) => input.approvals.find((approval) => (
        approval.requestDigest === requestDigest && approval.role === role
        && approval.policyRevision === input.policy.revision && approval.decision === 'approved'
        && approval.expiresAt > input.evaluatedAt
      ))!.id),
    },
  );
}

function disclosureDecision(
  input: DisclosureDecisionInput,
  requestDigest: string,
  disposition: DisclosureDisposition,
  reasonCodes: readonly DisclosureReasonCode[],
  extra: Partial<Pick<DisclosureDecision,
  'requiredTransformId' | 'requiredApprovalRoles' | 'approvalIds'>> = {},
): DisclosureDecision {
  return deepFreeze({
    disposition,
    requestDigest,
    reasonCodes: [...reasonCodes],
    policy: { revision: input.policy.revision, digest: input.policy.digest },
    contextBinding: {
      objectId: input.descriptor.objectId,
      payloadHash: input.descriptor.payloadHash,
      channel: input.context.channel,
      purpose: input.context.purpose,
      principalId: input.context.principal.principalId,
      ...(input.context.principal.assignmentId === undefined
        ? {}
        : { assignmentId: input.context.principal.assignmentId }),
      destinationId: input.context.destination.id,
      destinationContractDigest: input.context.destination.contractDigest,
      recipientRevision: input.context.recipients.revision,
      recipientDigest: input.context.recipients.digest,
      recipients: input.context.recipients.recipients.map((recipient) => ({ ...recipient })),
      principalSnapshot: {
        ...input.context.principal,
        allowedPurposes: [...input.context.principal.allowedPurposes],
      },
      destinationSnapshot: {
        ...input.context.destination,
        processingRegions: [...input.context.destination.processingRegions],
        allowedCategories: [...input.context.destination.allowedCategories],
      },
      recipientSnapshot: {
        revision: input.context.recipients.revision,
        digest: input.context.recipients.digest,
        recipients: input.context.recipients.recipients.map((recipient) => ({ ...recipient })),
      },
    },
    requiredApprovalRoles: [],
    approvalIds: [],
    ...extra,
  });
}

function disclosureRequestDigest(
  descriptor: DataDescriptor,
  context: DisclosureContext,
  policy: DataGovernancePolicySnapshot,
): string {
  const serialized = stableSerialize({
    descriptor,
    channel: context.channel,
    purpose: context.purpose,
    requestedMode: context.requestedMode,
    principal: context.principal,
    destination: context.destination,
    recipients: context.recipients,
    policyRevision: policy.revision,
    policyDigest: policy.digest,
  });
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const CONFIDENTIALITY_LEVEL: Readonly<Record<ConfidentialityClass, number>> = {
  public: 0,
  project_internal: 1,
  confidential: 2,
  restricted: 3,
  unknown: 4,
};

function stricterConfidentiality<T extends Exclude<ConfidentialityClass, 'unknown'>>(left: T, right: T): T {
  return CONFIDENTIALITY_LEVEL[left] >= CONFIDENTIALITY_LEVEL[right] ? left : right;
}

function moreRestrictiveCeiling<T extends Exclude<ConfidentialityClass, 'unknown'>>(left: T, right: T): T {
  return CONFIDENTIALITY_LEVEL[left] <= CONFIDENTIALITY_LEVEL[right] ? left : right;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
