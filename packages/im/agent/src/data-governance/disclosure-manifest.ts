import { createHash } from 'node:crypto';
import {
  assertDataGovernancePolicySnapshot,
  assertDisclosureRecipientSetSnapshot,
  assertProcessingDestinationContract,
  assertRegisteredDataDescriptor,
  decideDisclosure,
  type ConfidentialityClass,
  type DataDescriptor,
  type DataCategoryRegistrySnapshot,
  type DisclosureApprovalSnapshot,
  type DisclosureChannel,
  type DisclosureDecision,
  type DisclosureDecisionInput,
  type DisclosurePurpose,
} from './data-governance.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from '../workroom/canonical-value.js';

export interface PayloadVaultObjectHandle {
  readonly version: 1;
  readonly vaultObjectId: string;
  readonly objectId: string;
  readonly payloadHash: string;
  readonly descriptorDigest: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly locationManifestDigest: string;
}

export interface PayloadVaultReadInput {
  readonly handle: PayloadVaultObjectHandle;
  readonly requestDigest: string;
  readonly purpose: DisclosurePurpose;
  readonly principalId: string;
  readonly destinationId: string;
}

export interface PayloadVaultDerivedWriteInput {
  /** Complete canonical descriptor; the Vault independently binds every field. */
  readonly descriptor: DataDescriptor;
  readonly descriptorDigest: string;
  readonly payload: Uint8Array;
}

/** Generation-owned governed body store; implementations audit every exact read/write. */
export interface PayloadVaultPort {
  readExact(input: PayloadVaultReadInput, signal: AbortSignal): Promise<Uint8Array>;
  putDerived(
    input: PayloadVaultDerivedWriteInput,
    signal: AbortSignal,
  ): Promise<PayloadVaultObjectHandle>;
}

export interface TrustedDisclosureTransformObservation {
  readonly transformId: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly output: Uint8Array;
  readonly outputConfidentiality: Exclude<ConfidentialityClass, 'unknown'>;
  readonly outputCategories: readonly string[];
  readonly subjectLinked: boolean;
}

export interface TrustedDisclosureTransformPort {
  transform(input: Readonly<{
    transformId: string;
    requestDigest: string;
    descriptor: DataDescriptor;
    input: Uint8Array;
  }>, signal: AbortSignal): Promise<TrustedDisclosureTransformObservation>;
}

export interface MaterializedDisclosureManifest {
  readonly version: 1;
  readonly id: string;
  readonly digest: string;
  readonly requestDigest: string;
  readonly source: Readonly<{
    objectId: string;
    payloadHash: string;
    descriptorDigest: string;
    lineageDigest: string;
    handle: PayloadVaultObjectHandle;
  }>;
  readonly output: Readonly<{
    handle: PayloadVaultObjectHandle;
    payloadHash: string;
    mode: 'full' | 'metadata_only' | 'transformed';
    transformId?: string;
    subjectLinked: boolean;
  }>;
  readonly channel: DisclosureChannel;
  readonly purpose: DisclosurePurpose;
  readonly principal: Readonly<{ principalId: string; assignmentId?: string }>;
  readonly destination: Readonly<{
    id: string;
    contractDigest: string;
    recipientRevision: number;
    recipientDigest: string;
    loggingMode: 'disabled' | 'metadata_only' | 'full';
    allowsRedisclosure: boolean;
    supportsDeletion: boolean;
  }>;
  readonly policy: Readonly<{ revision: number; digest: string }>;
  readonly approvalIds: readonly string[];
  readonly expiresAt: number;
}

/** Authenticated identity plus authority object ids; no caller policy snapshots. */
export interface GovernedDisclosureManifestRequest {
  readonly operationId: string;
  readonly projectId: string;
  readonly sourceRef: string;
  readonly sourceDigest: string;
  readonly sinkRuleId: string;
  readonly principalId: string;
  readonly assignmentId?: string;
}

export interface GovernedDisclosureManifestSnapshot {
  readonly request: GovernedDisclosureManifestRequest;
  readonly manifest: MaterializedDisclosureManifest;
}

export async function materializeDisclosureManifest(input: Readonly<{
  decisionInput: DisclosureDecisionInput;
  categoryRegistry: DataCategoryRegistrySnapshot;
  source: PayloadVaultObjectHandle;
  vault: PayloadVaultPort;
  transforms?: TrustedDisclosureTransformPort;
  signal: AbortSignal;
}>): Promise<MaterializedDisclosureManifest> {
  input.signal.throwIfAborted();
  const request = {
    ...input,
    decisionInput: deepFreeze(structuredClone(input.decisionInput)),
    categoryRegistry: deepFreeze(structuredClone(input.categoryRegistry)),
    source: copyHandle(input.source),
  };
  assertProcessingDestinationContract(request.decisionInput.context.destination);
  assertDataGovernancePolicySnapshot(request.decisionInput.policy);
  assertDisclosureRecipientSetSnapshot(request.decisionInput.context.recipients);
  assertRegisteredDataDescriptor(request.decisionInput.descriptor, request.categoryRegistry);
  nonNegativeInteger(request.decisionInput.evaluatedAt, 'disclosure evaluatedAt');
  const decision = decideDisclosure(request.decisionInput);
  if (decision.disposition === 'deny' || decision.disposition === 'approval_required') {
    throw new Error(`Disclosure decision ${decision.disposition} is not materializable`);
  }
  assertSourceHandle(request.source, request.decisionInput.descriptor);
  const materialized = await materializeOutput(request, decision);
  const effectiveDecision = materialized.decision;
  const approved = exactApprovals(request.decisionInput.approvals, effectiveDecision.approvalIds,
    effectiveDecision.requestDigest, request.decisionInput.policy.revision, request.decisionInput.evaluatedAt);
  const expiresAt = Math.min(
    request.decisionInput.descriptor.retention.deleteAfter,
    request.decisionInput.evaluatedAt
      + positiveInteger(
        request.decisionInput.context.destination.maximumRetentionSeconds,
        'destination maximum retention seconds',
      ),
    ...approved.map(({ expiresAt: value }) => value),
  );
  const projection = deepFreeze({
    version: 1 as const,
    requestDigest: effectiveDecision.requestDigest,
    source: {
      objectId: request.decisionInput.descriptor.objectId,
      payloadHash: request.decisionInput.descriptor.payloadHash,
      descriptorDigest: digestCanonicalWorkroomValue(request.decisionInput.descriptor),
      lineageDigest: digestCanonicalWorkroomValue(request.decisionInput.descriptor.lineage),
      handle: copyHandle(request.source),
    },
    output: materialized.output,
    channel: request.decisionInput.context.channel,
    purpose: request.decisionInput.context.purpose,
    principal: {
      principalId: request.decisionInput.context.principal.principalId,
      ...(request.decisionInput.context.principal.assignmentId === undefined
        ? {}
        : { assignmentId: request.decisionInput.context.principal.assignmentId }),
    },
    destination: {
      id: request.decisionInput.context.destination.id,
      contractDigest: request.decisionInput.context.destination.contractDigest,
      recipientRevision: request.decisionInput.context.recipients.revision,
      recipientDigest: request.decisionInput.context.recipients.digest,
      loggingMode: request.decisionInput.context.destination.loggingMode,
      allowsRedisclosure: request.decisionInput.context.destination.allowsRedisclosure,
      supportsDeletion: request.decisionInput.context.destination.supportsDeletion,
    },
    policy: { revision: effectiveDecision.policy.revision, digest: effectiveDecision.policy.digest },
    approvalIds: Object.freeze(approved.map(({ id }) => id).sort()),
    expiresAt,
  });
  const digest = digestCanonicalWorkroomValue(projection);
  return deepFreeze({ ...projection, id: `disclosure-manifest:${digest}`, digest });
}

async function materializeOutput(
  input: Readonly<{
    decisionInput: DisclosureDecisionInput;
    categoryRegistry: DataCategoryRegistrySnapshot;
    source: PayloadVaultObjectHandle;
    vault: PayloadVaultPort;
    transforms?: TrustedDisclosureTransformPort;
    signal: AbortSignal;
  }>,
  decision: DisclosureDecision,
): Promise<Readonly<{
  output: MaterializedDisclosureManifest['output'];
  decision: DisclosureDecision;
}>> {
  if (decision.disposition === 'metadata_only') {
    const payload = new TextEncoder().encode(canonicalWorkroomJson({
      objectId: input.decisionInput.descriptor.objectId,
      payloadHash: input.decisionInput.descriptor.payloadHash,
      kind: input.decisionInput.descriptor.kind,
      confidentiality: input.decisionInput.descriptor.confidentiality,
      categories: input.decisionInput.descriptor.categories,
    }));
    const payloadHash = hashBytes(payload);
    const objectId = `disclosure-output:${decision.requestDigest}:metadata`;
    const outputDescriptor = derivedDescriptor(
      input.decisionInput.descriptor,
      objectId,
      payloadHash,
      input.decisionInput.descriptor.confidentiality,
      input.decisionInput.descriptor.categories,
    );
    assertRegisteredDataDescriptor(outputDescriptor, input.categoryRegistry);
    const descriptorDigest = digestCanonicalWorkroomValue(outputDescriptor);
    const handle = await abortable(input.vault.putDerived({
      descriptor: outputDescriptor,
      descriptorDigest,
      payload,
    }, input.signal), input.signal);
    if (hashBytes(payload) !== payloadHash) throw new Error('Payload Vault mutated materialized metadata');
    assertDerivedHandle(handle, objectId, payloadHash, descriptorDigest, input.decisionInput.descriptor);
    return deepFreeze({
      output: {
        handle: copyHandle(handle),
        payloadHash,
        mode: 'metadata_only',
        subjectLinked: input.decisionInput.descriptor.subjectRefs.length > 0,
      },
      decision,
    });
  }
  const body = await readSource(input, decision.requestDigest);
  if (decision.disposition === 'full') {
    return deepFreeze({
      output: {
        handle: copyHandle(input.source),
        payloadHash: input.source.payloadHash,
        mode: 'full',
        subjectLinked: input.decisionInput.descriptor.subjectRefs.length > 0,
      },
      decision,
    });
  }
  if (decision.disposition !== 'transform_required') {
    throw new Error(`Disclosure decision ${decision.disposition} is not materializable`);
  }
  const transformId = decision.requiredTransformId;
  if (!transformId || !input.transforms) throw new Error('Trusted disclosure transform is not installed');
  const trusted = input.decisionInput.policy.transforms[transformId];
  if (!trusted) throw new Error(`Trusted disclosure transform ${transformId} is unavailable`);
  const transformInput = new Uint8Array(body);
  // Typed arrays cannot be frozen by ECMAScript. The container and authority
  // are immutable; the byte copy is hash-verified again after the transform.
  const observation = await abortable(input.transforms.transform(Object.freeze({
    transformId,
    requestDigest: decision.requestDigest,
    descriptor: input.decisionInput.descriptor,
    input: transformInput,
  }), input.signal), input.signal);
  if (observation.transformId !== transformId
    || observation.inputHash !== input.source.payloadHash
    || hashBytes(transformInput) !== input.source.payloadHash
    || observation.outputHash !== hashBytes(observation.output)
    || observation.outputConfidentiality !== trusted.outputConfidentiality
    || canonicalWorkroomJson([...observation.outputCategories].sort())
      !== canonicalWorkroomJson([...trusted.outputCategories].sort())) {
    throw new Error('Trusted disclosure transform observation does not match the pinned transform');
  }
  if (input.decisionInput.descriptor.subjectRefs.length > 0 && !observation.subjectLinked) {
    throw new Error('Trusted disclosure transform cannot remove existing subject linkage');
  }
  const objectId = `disclosure-output:${decision.requestDigest}:transform:`
    + observation.outputHash.slice('sha256:'.length);
  const output = new Uint8Array(observation.output);
  const outputDescriptor = derivedDescriptor(
    input.decisionInput.descriptor,
    objectId,
    observation.outputHash,
    observation.outputConfidentiality,
    observation.outputCategories,
    transformId,
  );
  const descriptorDigest = digestCanonicalWorkroomValue(outputDescriptor);
  assertRegisteredDataDescriptor(outputDescriptor, input.categoryRegistry);
  const outputDecision = decideDisclosure({
    ...input.decisionInput,
    descriptor: outputDescriptor,
  });
  if (outputDecision.disposition === 'approval_required') {
    throw new Error(`Transformed disclosure approval required: ${outputDecision.requestDigest}`);
  }
  if (outputDecision.disposition !== 'full') {
    throw new Error(`Transformed disclosure decision ${outputDecision.disposition} is not materializable`);
  }
  exactApprovals(
    input.decisionInput.approvals,
    outputDecision.approvalIds,
    outputDecision.requestDigest,
    input.decisionInput.policy.revision,
    input.decisionInput.evaluatedAt,
  );
  const handle = await abortable(input.vault.putDerived({
    descriptor: outputDescriptor,
    descriptorDigest,
    payload: output,
  }, input.signal), input.signal);
  if (hashBytes(output) !== observation.outputHash) throw new Error('Payload Vault mutated transformed output');
  assertDerivedHandle(
    handle,
    objectId,
    observation.outputHash,
    descriptorDigest,
    input.decisionInput.descriptor,
  );
  return deepFreeze({
    output: {
      handle: copyHandle(handle), payloadHash: observation.outputHash, mode: 'transformed',
      transformId, subjectLinked: observation.subjectLinked,
    },
    decision: outputDecision,
  });
}

async function readSource(
  input: Readonly<{
    decisionInput: DisclosureDecisionInput;
    source: PayloadVaultObjectHandle;
    vault: PayloadVaultPort;
    signal: AbortSignal;
  }>,
  requestDigest: string,
): Promise<Uint8Array> {
  const body = await abortable(input.vault.readExact(deepFreeze({
    handle: copyHandle(input.source),
    requestDigest,
    purpose: input.decisionInput.context.purpose,
    principalId: input.decisionInput.context.principal.principalId,
    destinationId: input.decisionInput.context.destination.id,
  }), input.signal), input.signal);
  if (hashBytes(body) !== input.source.payloadHash) throw new Error('Payload Vault body hash mismatch');
  return body;
}

function exactApprovals(
  approvals: readonly DisclosureApprovalSnapshot[],
  approvalIds: readonly string[],
  requestDigest: string,
  policyRevision: number,
  evaluatedAt: number,
): readonly DisclosureApprovalSnapshot[] {
  if (new Set(approvalIds).size !== approvalIds.length) {
    throw new Error('Disclosure decision contains duplicate approval ids');
  }
  return approvalIds.map((id) => {
    const approval = approvals.find((candidate) => candidate.id === id
      && candidate.requestDigest === requestDigest
      && candidate.policyRevision === policyRevision
      && candidate.decision === 'approved'
      && candidate.expiresAt > evaluatedAt);
    if (!approval) throw new Error(`Disclosure approval ${id} is stale or unavailable`);
    return approval;
  });
}

function assertSourceHandle(handle: PayloadVaultObjectHandle, descriptor: DataDescriptor): void {
  assertHandle(handle);
  if (handle.objectId !== descriptor.objectId || handle.payloadHash !== descriptor.payloadHash
    || handle.descriptorDigest !== digestCanonicalWorkroomValue(descriptor)
    || handle.tenantId !== descriptor.tenantId || handle.projectId !== descriptor.projectId) {
    throw new Error('Payload Vault source handle does not match the Data Descriptor');
  }
}

function assertDerivedHandle(
  handle: PayloadVaultObjectHandle,
  objectId: string,
  payloadHash: string,
  descriptorDigest: string,
  descriptor: DataDescriptor,
): void {
  assertHandle(handle);
  if (handle.objectId !== objectId || handle.payloadHash !== payloadHash
    || handle.descriptorDigest !== descriptorDigest || handle.tenantId !== descriptor.tenantId
    || handle.projectId !== descriptor.projectId) {
    throw new Error('Payload Vault derived handle does not match materialized output');
  }
}

function assertHandle(handle: PayloadVaultObjectHandle): void {
  if (handle.version !== 1 || !canonicalText(handle.vaultObjectId) || !canonicalText(handle.objectId)
    || !canonicalText(handle.tenantId) || !canonicalText(handle.projectId)
    || !isDigest(handle.payloadHash) || !isDigest(handle.descriptorDigest)
    || !isDigest(handle.locationManifestDigest)) {
    throw new Error('Invalid Payload Vault object handle');
  }
}

function copyHandle(handle: PayloadVaultObjectHandle): PayloadVaultObjectHandle {
  return deepFreeze({ ...handle });
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}

function derivedDescriptor(
  source: DataDescriptor,
  objectId: string,
  payloadHash: string,
  confidentiality: Exclude<ConfidentialityClass, 'unknown'>,
  categories: readonly string[],
  transformRef?: string,
): DataDescriptor {
  return deepFreeze({
    ...source,
    objectId,
    payloadHash,
    kind: 'projection_payload',
    confidentiality,
    categories: [...categories].sort(),
    lineage: {
      sourceObjectIds: [source.objectId],
      ...(transformRef === undefined ? {} : { transformRef }),
    },
  });
}

function hashBytes(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isDigest(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function canonicalText(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new DOMException('Disclosure cancelled', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
