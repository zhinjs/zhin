import type { DataDescriptor } from './data-governance.js';
import type {
  PayloadVaultObjectHandle,
  PayloadVaultPort,
} from './disclosure-manifest.js';
import { PayloadVaultIntegrityError } from './encrypted-file-payload-vault.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';

export interface PayloadVaultHandoffAuthorityRequest {
  readonly version: 1;
  readonly action: 'copy_file_payload_to_database';
  readonly generation: number;
  readonly operationId: string;
  readonly authenticatedPrincipalId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly sourceHandleDigest: string;
  readonly sourceDescriptorDigest: string;
  readonly targetDescriptorDigest: string;
  readonly digest: string;
}

export interface PayloadVaultHandoffAuthorityDecision {
  readonly approved: true;
  readonly requestDigest: string;
  readonly decisionId: string;
  readonly principalId: string;
  readonly role: 'data_steward';
  readonly authorityDigest: string;
  readonly decidedAt: number;
}

export type PayloadVaultHandoffAuthorityResult = PayloadVaultHandoffAuthorityDecision | Readonly<{
  approved: false;
  requestDigest: string;
  reason: string;
}>;

export interface PayloadVaultHandoffAuthorityPort {
  authorize(request: PayloadVaultHandoffAuthorityRequest): Promise<PayloadVaultHandoffAuthorityResult>;
  verify(
    request: PayloadVaultHandoffAuthorityRequest,
    decision: PayloadVaultHandoffAuthorityDecision,
  ): Promise<boolean>;
}

export interface PayloadVaultHandoffReceipt {
  readonly version: 1;
  readonly handoffId: string;
  readonly revision: 1;
  readonly status: 'copied_pending_consumer_cutover';
  readonly sourceHandle: PayloadVaultObjectHandle;
  readonly targetHandle: PayloadVaultObjectHandle;
  readonly sourceDescriptorDigest: string;
  readonly targetDescriptorDigest: string;
  readonly supersedes: Readonly<{
    vaultObjectId: string;
    descriptorDigest: string;
  }>;
  readonly lineage: Readonly<{
    sourceObjectId: string;
    targetObjectId: string;
    transformRef: 'storage-handoff:file-to-database:v1';
  }>;
  readonly authorityRequest: PayloadVaultHandoffAuthorityRequest;
  readonly authorityDecision: PayloadVaultHandoffAuthorityDecision;
  readonly digest: string;
}

export interface PayloadVaultHandoffRepository {
  read(handoffId: string): Promise<PayloadVaultHandoffReceipt | undefined>;
  create(receipt: PayloadVaultHandoffReceipt): Promise<PayloadVaultHandoffReceipt>;
}

export interface PayloadVaultHandoffDatabaseModel {
  select(...fields: string[]): {
    where(query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
}

export interface PayloadVaultHandoffDatabase {
  transaction<T>(operation: (transaction: Readonly<{
    select(table: string): { where(query: Record<string, unknown>): Promise<Record<string, unknown>[]> };
    insertMany(table: string, rows: Record<string, unknown>[]): Promise<unknown>;
  }>) => Promise<T>, options: { isolationLevel: 'SERIALIZABLE' }): Promise<T>;
}

export const PAYLOAD_VAULT_HANDOFF_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  handoff_id: { type: 'text' as const, nullable: false },
  project_id: { type: 'text' as const, nullable: false },
  source_vault_object_id: { type: 'text' as const, nullable: false },
  target_vault_object_id: { type: 'text' as const, nullable: false },
  receipt_digest: { type: 'text' as const, nullable: false },
  receipt_json: { type: 'text' as const, nullable: false },
};

export class DatabasePayloadVaultHandoffRepository implements PayloadVaultHandoffRepository {
  constructor(
    readonly database: PayloadVaultHandoffDatabase,
    readonly model: PayloadVaultHandoffDatabaseModel,
  ) {}

  async read(handoffId: string): Promise<PayloadVaultHandoffReceipt | undefined> {
    const id = required(handoffId, 'handoffId');
    const rows = await this.model.select().where({ handoff_id: id });
    if (rows.length === 0) return undefined;
    return parseRow(rows, id);
  }

  async create(receipt: PayloadVaultHandoffReceipt): Promise<PayloadVaultHandoffReceipt> {
    assertReceipt(receipt);
    try {
      return await this.database.transaction(async transaction => {
        const rows = await transaction.select('payload_vault_handoffs').where({
          handoff_id: receipt.handoffId,
        });
        if (rows.length > 0) return exactReplay(parseRow(rows, receipt.handoffId), receipt);
        await transaction.insertMany('payload_vault_handoffs', [toRow(receipt)]);
        return receipt;
      }, { isolationLevel: 'SERIALIZABLE' });
    } catch (error) {
      if (!isDatabaseCasLoser(error)) throw error;
      const winner = await this.read(receipt.handoffId);
      if (!winner) throw new PayloadVaultIntegrityError('Payload Vault handoff CAS winner is absent');
      return exactReplay(winner, receipt);
    }
  }
}

export interface PayloadVaultFileToDatabaseHandoffOptions {
  readonly source: Pick<PayloadVaultPort, 'readExact'>;
  readonly target: Pick<PayloadVaultPort, 'putDerived'>;
  readonly repository: PayloadVaultHandoffRepository;
  readonly authority: PayloadVaultHandoffAuthorityPort;
  readonly generation: number;
}

/** Trusted Root migration service. It never publishes either raw Vault port. */
export class PayloadVaultFileToDatabaseHandoff {
  readonly #source: Pick<PayloadVaultPort, 'readExact'>;
  readonly #target: Pick<PayloadVaultPort, 'putDerived'>;
  readonly #repository: PayloadVaultHandoffRepository;
  readonly #authority: PayloadVaultHandoffAuthorityPort;
  readonly #generation: number;

  constructor(options: PayloadVaultFileToDatabaseHandoffOptions) {
    this.#source = options.source;
    this.#target = options.target;
    this.#repository = options.repository;
    this.#authority = options.authority;
    this.#generation = positive(options.generation, 'generation');
  }

  async migrate(input: Readonly<{
    operationId: string;
    authenticatedPrincipalId: string;
    sourceHandle: PayloadVaultObjectHandle;
    sourceDescriptor: DataDescriptor;
    targetObjectId: string;
  }>, signal: AbortSignal): Promise<PayloadVaultHandoffReceipt> {
    signal.throwIfAborted();
    const sourceDescriptor = deepFreeze(structuredClone(input.sourceDescriptor));
    const sourceDescriptorDigest = digest(sourceDescriptor);
    assertSourceBinding(input.sourceHandle, sourceDescriptor, sourceDescriptorDigest);
    const targetObjectId = required(input.targetObjectId, 'targetObjectId');
    if (targetObjectId === sourceDescriptor.objectId) {
      throw new PayloadVaultIntegrityError('Payload Vault handoff must mint a new object identity');
    }
    const targetDescriptor = deepFreeze<DataDescriptor>({
      ...sourceDescriptor,
      objectId: targetObjectId,
      kind: 'projection_payload',
      lineage: {
        sourceObjectIds: [sourceDescriptor.objectId],
        transformRef: 'storage-handoff:file-to-database:v1',
      },
    });
    const targetDescriptorDigest = digest(targetDescriptor);
    const requestBody = deepFreeze({
      version: 1 as const,
      action: 'copy_file_payload_to_database' as const,
      generation: this.#generation,
      operationId: required(input.operationId, 'operationId'),
      authenticatedPrincipalId: required(input.authenticatedPrincipalId, 'authenticatedPrincipalId'),
      tenantId: sourceDescriptor.tenantId,
      projectId: sourceDescriptor.projectId,
      sourceHandleDigest: digest(input.sourceHandle),
      sourceDescriptorDigest,
      targetDescriptorDigest,
    });
    const request = deepFreeze<PayloadVaultHandoffAuthorityRequest>({
      ...requestBody,
      digest: digest(requestBody),
    });
    const handoffId = `payload-vault-handoff:${request.digest.slice('sha256:'.length)}`;
    const existing = await this.#repository.read(handoffId);
    if (existing) return existing;
    const decision = await this.#authority.authorize(request);
    if (!decision.approved || decision.requestDigest !== request.digest
      || decision.principalId !== request.authenticatedPrincipalId
      || decision.role !== 'data_steward'
      || !await this.#authority.verify(request, decision)) {
      throw new PayloadVaultIntegrityError('Payload Vault handoff is not authorized');
    }
    signal.throwIfAborted();
    const payload = await this.#source.readExact({
      handle: input.sourceHandle,
      requestDigest: request.digest,
      purpose: 'reconciliation',
      principalId: request.authenticatedPrincipalId,
      destinationId: 'payload-vault:file-to-database-handoff',
    }, signal);
    try {
      const targetHandle = await this.#target.putDerived({
        descriptor: targetDescriptor,
        descriptorDigest: targetDescriptorDigest,
        payload,
      }, signal);
      if (targetHandle.vaultObjectId === input.sourceHandle.vaultObjectId
        || targetHandle.objectId !== targetObjectId
        || targetHandle.payloadHash !== input.sourceHandle.payloadHash
        || targetHandle.descriptorDigest !== targetDescriptorDigest) {
        throw new PayloadVaultIntegrityError('Payload Vault handoff target binding is invalid');
      }
      const body = deepFreeze({
        version: 1 as const,
        handoffId,
        revision: 1 as const,
        status: 'copied_pending_consumer_cutover' as const,
        sourceHandle: structuredClone(input.sourceHandle),
        targetHandle: structuredClone(targetHandle),
        sourceDescriptorDigest,
        targetDescriptorDigest,
        supersedes: {
          vaultObjectId: input.sourceHandle.vaultObjectId,
          descriptorDigest: input.sourceHandle.descriptorDigest,
        },
        lineage: {
          sourceObjectId: sourceDescriptor.objectId,
          targetObjectId,
          transformRef: 'storage-handoff:file-to-database:v1' as const,
        },
        authorityRequest: request,
        authorityDecision: deepFreeze(structuredClone(decision)),
      });
      return await this.#repository.create(deepFreeze({ ...body, digest: digest(body) }));
    } finally {
      payload.fill(0);
    }
  }
}

export function definePayloadVaultHandoffDatabaseModel(
  database: Readonly<{ define(name: string, definition: unknown): void }>,
): void {
  database.define('payload_vault_handoffs', PAYLOAD_VAULT_HANDOFF_MODEL);
}

export interface PayloadVaultConsumerCutoverSnapshot {
  readonly version: 1;
  readonly handoffId: string;
  readonly targetVaultObjectId: string;
  readonly revision: number;
  readonly expectedConsumerDigests: readonly string[];
  readonly switchedConsumerDigests: readonly string[];
  readonly digest: string;
}

export interface PayloadVaultConsumerCutoverAuthorityPort {
  resolve(
    handoff: PayloadVaultHandoffReceipt,
    signal: AbortSignal,
  ): Promise<PayloadVaultConsumerCutoverSnapshot | undefined>;
}

export interface PayloadVaultSourcePurgeState {
  readonly version: 1;
  readonly projectId: string;
  readonly objectId: string;
  readonly sourceHandle: PayloadVaultObjectHandle;
  readonly stateDigest: string;
  readonly objectAuthorityDigest: string;
  readonly locationManifestDigest: string;
  readonly purgeCompletionDigest?: string;
}

export interface PayloadVaultSourcePurgeStatePort {
  /** Must derive from a Lifecycle Runtime read that reverified every governance proof. */
  resolve(
    sourceHandle: PayloadVaultObjectHandle,
    signal: AbortSignal,
  ): Promise<PayloadVaultSourcePurgeState | undefined>;
}

export interface PayloadVaultSourceRetirementAuthorityRequest {
  readonly version: 1;
  readonly action: 'authorize_file_payload_source_retirement';
  readonly operationId: string;
  readonly authenticatedPrincipalId: string;
  readonly handoffId: string;
  readonly handoffReceiptDigest: string;
  readonly consumerCutoverDigest: string;
  readonly lifecycleStateDigest: string;
  readonly purgeCompletionDigest: string;
  readonly digest: string;
}

export interface PayloadVaultSourceRetirementAuthorityPort {
  authorize(
    request: PayloadVaultSourceRetirementAuthorityRequest,
  ): Promise<PayloadVaultHandoffAuthorityResult>;
  verify(
    request: PayloadVaultSourceRetirementAuthorityRequest,
    decision: PayloadVaultHandoffAuthorityDecision,
  ): Promise<boolean>;
}

export interface PayloadVaultSourceRetirementProof {
  readonly version: 1;
  readonly handoffId: string;
  readonly sourceHandle: PayloadVaultObjectHandle;
  readonly targetHandle: PayloadVaultObjectHandle;
  readonly consumerCutover: PayloadVaultConsumerCutoverSnapshot;
  readonly lifecycleStateDigest: string;
  readonly purgeCompletionDigest: string;
  readonly request: PayloadVaultSourceRetirementAuthorityRequest;
  readonly decision: PayloadVaultHandoffAuthorityDecision;
  readonly digest: string;
}

export interface PayloadVaultRetirementRepository {
  read(handoffId: string): Promise<PayloadVaultSourceRetirementProof | undefined>;
  create(proof: PayloadVaultSourceRetirementProof): Promise<PayloadVaultSourceRetirementProof>;
}

export const PAYLOAD_VAULT_HANDOFF_RETIREMENT_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  handoff_id: { type: 'text' as const, nullable: false },
  source_vault_object_id: { type: 'text' as const, nullable: false },
  target_vault_object_id: { type: 'text' as const, nullable: false },
  proof_digest: { type: 'text' as const, nullable: false },
  proof_json: { type: 'text' as const, nullable: false },
};

export class DatabasePayloadVaultRetirementRepository implements PayloadVaultRetirementRepository {
  constructor(
    readonly database: PayloadVaultHandoffDatabase,
    readonly model: PayloadVaultHandoffDatabaseModel,
  ) {}

  async read(handoffId: string): Promise<PayloadVaultSourceRetirementProof | undefined> {
    const id = required(handoffId, 'retirement handoffId');
    const rows = await this.model.select().where({ handoff_id: id });
    if (rows.length === 0) return undefined;
    return parseRetirementRow(rows, id);
  }

  async create(proof: PayloadVaultSourceRetirementProof): Promise<PayloadVaultSourceRetirementProof> {
    assertRetirementProof(proof);
    try {
      return await this.database.transaction(async transaction => {
        const rows = await transaction.select('payload_vault_handoff_retirements').where({
          handoff_id: proof.handoffId,
        });
        if (rows.length > 0) return exactRetirementReplay(parseRetirementRow(rows, proof.handoffId), proof);
        await transaction.insertMany('payload_vault_handoff_retirements', [retirementRow(proof)]);
        return proof;
      }, { isolationLevel: 'SERIALIZABLE' });
    } catch (error) {
      if (!isDatabaseCasLoser(error)) throw error;
      const winner = await this.read(proof.handoffId);
      if (!winner) throw new PayloadVaultIntegrityError('Payload Vault retirement CAS winner is absent');
      return exactRetirementReplay(winner, proof);
    }
  }
}

/**
 * This proof is the only signal that a File source may be retired. Creating a
 * DB copy alone is deliberately insufficient.
 */
export class PayloadVaultSourceRetirementGate {
  constructor(readonly options: Readonly<{
    handoffs: PayloadVaultHandoffRepository;
    retirements: PayloadVaultRetirementRepository;
    consumers: PayloadVaultConsumerCutoverAuthorityPort;
    lifecycle: PayloadVaultSourcePurgeStatePort;
    authority: PayloadVaultSourceRetirementAuthorityPort;
  }>) {}

  async authorize(input: Readonly<{
    handoffId: string;
    operationId: string;
    authenticatedPrincipalId: string;
  }>, signal: AbortSignal): Promise<PayloadVaultSourceRetirementProof> {
    signal.throwIfAborted();
    const handoffId = required(input.handoffId, 'retirement handoffId');
    const handoff = await this.options.handoffs.read(handoffId);
    if (!handoff) throw new PayloadVaultIntegrityError('Payload Vault handoff receipt is unavailable');
    const existing = await this.options.retirements.read(handoffId);
    if (existing) {
      assertRetirementMatchesHandoff(existing, handoff);
      return existing;
    }
    const consumerCutover = await this.options.consumers.resolve(handoff, signal);
    assertCompleteConsumerCutover(consumerCutover, handoff);
    const lifecycle = await this.options.lifecycle.resolve(handoff.sourceHandle, signal);
    if (!lifecycle || lifecycle.version !== 1
      || lifecycle.projectId !== handoff.sourceHandle.projectId
      || lifecycle.objectId !== handoff.sourceHandle.objectId
      || canonicalWorkroomJson(lifecycle.sourceHandle) !== canonicalWorkroomJson(handoff.sourceHandle)
      || lifecycle.locationManifestDigest !== handoff.sourceHandle.locationManifestDigest
      || !isDigest(lifecycle.stateDigest) || !isDigest(lifecycle.objectAuthorityDigest)
      || !isDigest(lifecycle.purgeCompletionDigest)) {
      throw new PayloadVaultIntegrityError('Payload Vault source purge completion is unavailable or stale');
    }
    const requestBody = deepFreeze({
      version: 1 as const,
      action: 'authorize_file_payload_source_retirement' as const,
      operationId: required(input.operationId, 'retirement operationId'),
      authenticatedPrincipalId: required(input.authenticatedPrincipalId, 'retirement principalId'),
      handoffId,
      handoffReceiptDigest: handoff.digest,
      consumerCutoverDigest: consumerCutover.digest,
      lifecycleStateDigest: lifecycle.stateDigest,
      purgeCompletionDigest: lifecycle.purgeCompletionDigest,
    });
    const request = deepFreeze({ ...requestBody, digest: digest(requestBody) });
    const decision = await this.options.authority.authorize(request);
    if (!decision.approved || decision.requestDigest !== request.digest
      || decision.principalId !== request.authenticatedPrincipalId
      || decision.role !== 'data_steward'
      || !await this.options.authority.verify(request, decision)) {
      throw new PayloadVaultIntegrityError('Payload Vault source retirement is not authorized');
    }
    const body = deepFreeze({
      version: 1 as const,
      handoffId,
      sourceHandle: handoff.sourceHandle,
      targetHandle: handoff.targetHandle,
      consumerCutover,
      lifecycleStateDigest: lifecycle.stateDigest,
      purgeCompletionDigest: lifecycle.purgeCompletionDigest,
      request,
      decision: deepFreeze(structuredClone(decision)),
    });
    return await this.options.retirements.create(deepFreeze({ ...body, digest: digest(body) }));
  }
}

export function definePayloadVaultRetirementDatabaseModel(
  database: Readonly<{ define(name: string, definition: unknown): void }>,
): void {
  database.define('payload_vault_handoff_retirements', PAYLOAD_VAULT_HANDOFF_RETIREMENT_MODEL);
}

function assertCompleteConsumerCutover(
  snapshot: PayloadVaultConsumerCutoverSnapshot | undefined,
  handoff: Readonly<{ handoffId: string; targetHandle: PayloadVaultObjectHandle }>,
): asserts snapshot is PayloadVaultConsumerCutoverSnapshot {
  if (!snapshot || snapshot.version !== 1 || snapshot.handoffId !== handoff.handoffId
    || snapshot.targetVaultObjectId !== handoff.targetHandle.vaultObjectId
    || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1
    || snapshot.digest !== digestWithoutAny(snapshot)) {
    throw new PayloadVaultIntegrityError('Payload Vault consumer cutover authority is unavailable or stale');
  }
  const expected = uniqueDigests(snapshot.expectedConsumerDigests);
  const switched = uniqueDigests(snapshot.switchedConsumerDigests);
  if (expected.length === 0 || canonicalWorkroomJson(expected) !== canonicalWorkroomJson(switched)
    || canonicalWorkroomJson(expected) !== canonicalWorkroomJson(snapshot.expectedConsumerDigests)
    || canonicalWorkroomJson(switched) !== canonicalWorkroomJson(snapshot.switchedConsumerDigests)) {
    throw new PayloadVaultIntegrityError('Payload Vault consumer cutover is incomplete');
  }
}

function retirementRow(proof: PayloadVaultSourceRetirementProof): Record<string, unknown> {
  return {
    id: proof.handoffId,
    handoff_id: proof.handoffId,
    source_vault_object_id: proof.sourceHandle.vaultObjectId,
    target_vault_object_id: proof.targetHandle.vaultObjectId,
    proof_digest: proof.digest,
    proof_json: canonicalWorkroomJson(proof),
  };
}

function parseRetirementRow(
  rows: readonly Record<string, unknown>[],
  handoffId: string,
): PayloadVaultSourceRetirementProof {
  if (rows.length !== 1) throw new PayloadVaultIntegrityError('Payload Vault retirement row is duplicated');
  const row = rows[0]!;
  exactKeys(row, ['id', 'handoff_id', 'source_vault_object_id', 'target_vault_object_id',
    'proof_digest', 'proof_json']);
  if (row.id !== handoffId || row.handoff_id !== handoffId || typeof row.proof_json !== 'string') {
    throw new PayloadVaultIntegrityError('Payload Vault retirement row identity drift');
  }
  let proof: PayloadVaultSourceRetirementProof;
  try {
    proof = JSON.parse(row.proof_json) as PayloadVaultSourceRetirementProof;
  } catch (error) {
    throw new PayloadVaultIntegrityError('Payload Vault retirement proof is malformed', { cause: error });
  }
  assertRetirementProof(proof);
  if (row.proof_json !== canonicalWorkroomJson(proof) || row.proof_digest !== proof.digest
    || row.source_vault_object_id !== proof.sourceHandle.vaultObjectId
    || row.target_vault_object_id !== proof.targetHandle.vaultObjectId) {
    throw new PayloadVaultIntegrityError('Payload Vault retirement row binding drift');
  }
  return deepFreeze(structuredClone(proof));
}

function assertRetirementProof(proof: PayloadVaultSourceRetirementProof): void {
  const { digest: supplied, ...body } = proof;
  assertCompleteConsumerCutover(proof.consumerCutover, {
    handoffId: proof.handoffId,
    targetHandle: proof.targetHandle,
  });
  if (proof.version !== 1 || proof.request.version !== 1
    || proof.request.action !== 'authorize_file_payload_source_retirement'
    || proof.request.handoffId !== proof.handoffId
    || !isDigest(proof.request.handoffReceiptDigest)
    || proof.request.consumerCutoverDigest !== proof.consumerCutover.digest
    || proof.request.lifecycleStateDigest !== proof.lifecycleStateDigest
    || proof.request.purgeCompletionDigest !== proof.purgeCompletionDigest
    || !isDigest(proof.lifecycleStateDigest) || !isDigest(proof.purgeCompletionDigest)
    || proof.request.digest !== digestWithoutAny(proof.request)
    || proof.sourceHandle.vaultObjectId === proof.targetHandle.vaultObjectId
    || proof.sourceHandle.payloadHash !== proof.targetHandle.payloadHash
    || proof.decision.requestDigest !== proof.request.digest
    || proof.decision.principalId !== proof.request.authenticatedPrincipalId
    || proof.decision.role !== 'data_steward' || !isDigest(proof.decision.authorityDigest)
    || !Number.isSafeInteger(proof.decision.decidedAt) || proof.decision.decidedAt < 0
    || supplied !== digest(body)) {
    throw new PayloadVaultIntegrityError('Payload Vault source retirement proof binding drift');
  }
}

function assertRetirementMatchesHandoff(
  proof: PayloadVaultSourceRetirementProof,
  handoff: PayloadVaultHandoffReceipt,
): void {
  if (proof.handoffId !== handoff.handoffId
    || proof.request.handoffReceiptDigest !== handoff.digest
    || canonicalWorkroomJson(proof.sourceHandle) !== canonicalWorkroomJson(handoff.sourceHandle)
    || canonicalWorkroomJson(proof.targetHandle) !== canonicalWorkroomJson(handoff.targetHandle)) {
    throw new PayloadVaultIntegrityError('Payload Vault source retirement/handoff binding drift');
  }
}

function exactRetirementReplay(
  winner: PayloadVaultSourceRetirementProof,
  candidate: PayloadVaultSourceRetirementProof,
): PayloadVaultSourceRetirementProof {
  if (canonicalWorkroomJson(winner) !== canonicalWorkroomJson(candidate)) {
    throw new PayloadVaultIntegrityError('Payload Vault source retirement CAS replay drift');
  }
  return winner;
}

function uniqueDigests(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values)) throw new PayloadVaultIntegrityError('Payload Vault consumer digests are invalid');
  return [...new Set(values.map(value => {
    if (!isDigest(value)) throw new PayloadVaultIntegrityError('Payload Vault consumer digest is invalid');
    return value;
  }))].sort();
}

function digestWithoutAny<T extends Readonly<{ digest: string }>>(value: T): string {
  const { digest: _digest, ...body } = value;
  return digest(body);
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f\d]{64}$/u.test(value);
}

function assertSourceBinding(
  handle: PayloadVaultObjectHandle,
  descriptor: DataDescriptor,
  descriptorDigest: string,
): void {
  if (handle.version !== 1 || handle.objectId !== descriptor.objectId
    || handle.payloadHash !== descriptor.payloadHash || handle.tenantId !== descriptor.tenantId
    || handle.projectId !== descriptor.projectId || handle.descriptorDigest !== descriptorDigest) {
    throw new PayloadVaultIntegrityError('Payload Vault handoff source Descriptor binding is invalid');
  }
}

function toRow(receipt: PayloadVaultHandoffReceipt): Record<string, unknown> {
  return {
    id: receipt.handoffId,
    handoff_id: receipt.handoffId,
    project_id: receipt.sourceHandle.projectId,
    source_vault_object_id: receipt.sourceHandle.vaultObjectId,
    target_vault_object_id: receipt.targetHandle.vaultObjectId,
    receipt_digest: receipt.digest,
    receipt_json: canonicalWorkroomJson(receipt),
  };
}

function parseRow(
  rows: readonly Record<string, unknown>[],
  handoffId: string,
): PayloadVaultHandoffReceipt {
  if (rows.length !== 1) throw new PayloadVaultIntegrityError('Payload Vault handoff row is duplicated');
  const row = rows[0]!;
  exactKeys(row, ['id', 'handoff_id', 'project_id', 'source_vault_object_id',
    'target_vault_object_id', 'receipt_digest', 'receipt_json']);
  if (row.id !== handoffId || row.handoff_id !== handoffId || typeof row.receipt_json !== 'string') {
    throw new PayloadVaultIntegrityError('Payload Vault handoff row identity drift');
  }
  let receipt: PayloadVaultHandoffReceipt;
  try {
    receipt = JSON.parse(row.receipt_json) as PayloadVaultHandoffReceipt;
  } catch (error) {
    throw new PayloadVaultIntegrityError('Payload Vault handoff receipt is malformed', { cause: error });
  }
  assertReceipt(receipt);
  if (row.receipt_json !== canonicalWorkroomJson(receipt) || row.receipt_digest !== receipt.digest
    || row.project_id !== receipt.sourceHandle.projectId
    || row.source_vault_object_id !== receipt.sourceHandle.vaultObjectId
    || row.target_vault_object_id !== receipt.targetHandle.vaultObjectId) {
    throw new PayloadVaultIntegrityError('Payload Vault handoff row binding drift');
  }
  return deepFreeze(structuredClone(receipt));
}

function assertReceipt(receipt: PayloadVaultHandoffReceipt): void {
  const { digest: supplied, ...body } = receipt;
  if (receipt.version !== 1 || receipt.revision !== 1
    || receipt.status !== 'copied_pending_consumer_cutover'
    || receipt.handoffId !== `payload-vault-handoff:${receipt.authorityRequest.digest.slice('sha256:'.length)}`
    || receipt.authorityRequest.digest !== digestWithout(receipt.authorityRequest)
    || receipt.authorityDecision.requestDigest !== receipt.authorityRequest.digest
    || receipt.authorityDecision.principalId !== receipt.authorityRequest.authenticatedPrincipalId
    || receipt.authorityDecision.role !== 'data_steward'
    || receipt.sourceDescriptorDigest !== receipt.sourceHandle.descriptorDigest
    || receipt.targetDescriptorDigest !== receipt.targetHandle.descriptorDigest
    || receipt.targetHandle.payloadHash !== receipt.sourceHandle.payloadHash
    || receipt.targetHandle.vaultObjectId === receipt.sourceHandle.vaultObjectId
    || receipt.supersedes.vaultObjectId !== receipt.sourceHandle.vaultObjectId
    || receipt.supersedes.descriptorDigest !== receipt.sourceHandle.descriptorDigest
    || supplied !== digest(body)) {
    throw new PayloadVaultIntegrityError('Payload Vault handoff receipt binding drift');
  }
}

function digestWithout(value: PayloadVaultHandoffAuthorityRequest): string {
  const { digest: _digest, ...body } = value;
  return digest(body);
}

function exactReplay(
  winner: PayloadVaultHandoffReceipt,
  candidate: PayloadVaultHandoffReceipt,
): PayloadVaultHandoffReceipt {
  if (canonicalWorkroomJson(winner) !== canonicalWorkroomJson(candidate)) {
    throw new PayloadVaultIntegrityError('Payload Vault handoff CAS replay drift');
  }
  return winner;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (canonicalWorkroomJson(Object.keys(value).sort()) !== canonicalWorkroomJson([...keys].sort())) {
    throw new PayloadVaultIntegrityError('Payload Vault handoff row shape drift');
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new PayloadVaultIntegrityError(`Payload Vault handoff ${label} is invalid`);
  }
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PayloadVaultIntegrityError(`Payload Vault handoff ${label} must be positive`);
  }
  return value;
}

function isDatabaseCasLoser(error: unknown): boolean {
  return error instanceof Error
    && ('code' in error && ['23505', 'SQLITE_CONSTRAINT', 'ER_DUP_ENTRY'].includes(String(error.code))
      || /unique|duplicate|constraint/iu.test(error.message));
}
