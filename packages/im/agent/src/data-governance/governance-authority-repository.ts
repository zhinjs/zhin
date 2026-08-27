import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertDataCategoryRegistrySnapshot,
  assertDataGovernancePolicySnapshot,
  assertDisclosureRecipientSetSnapshot,
  assertRegisteredDataDescriptor,
  type ConfidentialityClass,
  type DataCategoryRegistrySnapshot,
  type DataDescriptor,
  type DataGovernancePolicySnapshot,
  type DisclosureApprovalSnapshot,
  type DisclosurePrincipalSnapshot,
  type DisclosurePurpose,
  type DisclosureRecipientSetSnapshot,
  type RetentionClass,
} from './data-governance.js';
import type { PayloadVaultObjectHandle } from './disclosure-manifest.js';
import {
  canonicalWorkroomJson,
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import { DurableFileStore } from '../workroom/durable-file-store.js';

export interface WorkroomPlanningDataRule {
  readonly destinationId: string;
  readonly recipients: DisclosureRecipientSetSnapshot;
  readonly principal: Readonly<Pick<
  DisclosurePrincipalSnapshot,
  'role' | 'clearance' | 'allowedPurposes'
  >>;
  readonly source: Readonly<{
    proposedConfidentiality: Exclude<ConfidentialityClass, 'unknown'>;
    categories: readonly string[];
    allowedPurposes: readonly DisclosurePurpose[];
    allowedRegions: readonly string[];
    retentionClass: RetentionClass;
    minimumRetentionMs: number;
    maximumRetentionMs: number;
    requestedMode: 'full' | 'metadata_only';
    linkPrincipalAsSubject: boolean;
  }>;
}

export interface WorkroomRemoteDisclosureRule {
  readonly recipients: DisclosureRecipientSetSnapshot;
  readonly principal: Readonly<Pick<DisclosurePrincipalSnapshot, 'role' | 'clearance' | 'allowedPurposes'>>;
  readonly requestedMode: 'full' | 'metadata_only';
}

export interface WorkroomSinkDisclosureRule extends WorkroomRemoteDisclosureRule {
  readonly destinationId: string;
  readonly channel: 'context_view' | 'evidence_port' | 'workroom_projection' | 'sponsor_projection' | 'console' | 'model_provider' | 'a2a';
  readonly purpose: DisclosurePurpose;
  /** Trusted service sinks may pin identity instead of accepting caller identity. */
  readonly fixedPrincipalId?: string;
}

export interface WorkroomDerivedPayloadRule {
  readonly proposedConfidentiality: Exclude<ConfidentialityClass, 'unknown'>;
  readonly categories: readonly string[];
  readonly allowedPurposes: readonly DisclosurePurpose[];
  readonly allowedRegions: readonly string[];
  readonly retentionClass: RetentionClass;
  readonly minimumRetentionMs: number;
  readonly maximumRetentionMs: number;
}

export interface DataGovernanceAuthorityDecision {
  readonly decisionId: string;
  readonly projectId: string;
  readonly expectedPreviousDigest?: string;
  readonly candidateDigest: string;
  readonly principalId: string;
  readonly authorizedBy: 'data_steward' | 'sponsor';
  readonly decidedAt: number;
  /** Present on Catalog-mediated publications; historical authorities may predate this binding. */
  readonly catalogRevision?: string;
  readonly catalogBindingDigest?: string;
}

export interface ProjectDataGovernanceAuthorityInput {
  readonly version: 1;
  readonly revision: number;
  readonly previousDigest?: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly categoryRegistry: DataCategoryRegistrySnapshot;
  readonly policy: DataGovernancePolicySnapshot;
  readonly planning: WorkroomPlanningDataRule;
  readonly remote: Readonly<Record<string, WorkroomRemoteDisclosureRule>>;
  readonly sinks: Readonly<Record<string, WorkroomSinkDisclosureRule>>;
  readonly derivedPayloads: Readonly<{
    evidence?: WorkroomDerivedPayloadRule;
    taskReport?: WorkroomDerivedPayloadRule;
    projection?: WorkroomDerivedPayloadRule;
    acceptanceProjection?: WorkroomDerivedPayloadRule;
    journal?: WorkroomDerivedPayloadRule;
  }>;
  readonly approvals: readonly DisclosureApprovalSnapshot[];
  readonly governanceDecision: DataGovernanceAuthorityDecision;
}

export interface ProjectDataGovernanceAuthority extends ProjectDataGovernanceAuthorityInput {
  readonly digest: string;
}

export function canonicalizeProjectDataGovernanceAuthorityCandidate(
  input: Omit<ProjectDataGovernanceAuthorityInput, 'governanceDecision'>,
): Omit<ProjectDataGovernanceAuthorityInput, 'governanceDecision'> {
  return deepFreeze({
    ...structuredClone(input),
    planning: {
      ...structuredClone(input.planning),
      principal: {
        ...structuredClone(input.planning.principal),
        allowedPurposes: unique(input.planning.principal.allowedPurposes),
      },
      source: {
        ...structuredClone(input.planning.source),
        categories: unique(input.planning.source.categories),
        allowedPurposes: unique(input.planning.source.allowedPurposes),
        allowedRegions: unique(input.planning.source.allowedRegions),
      },
    },
    remote: Object.fromEntries(Object.entries(input.remote)
      .sort(([left], [right]) => compareCanonicalWorkroomText(left, right))
      .map(([destinationId, rule]) => [destinationId, {
        ...structuredClone(rule),
        principal: {
          ...structuredClone(rule.principal),
          allowedPurposes: unique(rule.principal.allowedPurposes),
        },
      }])),
    sinks: Object.fromEntries(Object.entries(input.sinks)
      .sort(([left], [right]) => compareCanonicalWorkroomText(left, right))
      .map(([ruleId, rule]) => [ruleId, {
        ...structuredClone(rule),
        principal: {
          ...structuredClone(rule.principal),
          allowedPurposes: unique(rule.principal.allowedPurposes),
        },
      }])),
    derivedPayloads: Object.fromEntries(Object.entries(input.derivedPayloads)
      .sort(([left], [right]) => compareCanonicalWorkroomText(left, right))
      .map(([kind, rule]) => [kind, {
        ...structuredClone(rule),
        categories: unique(rule.categories),
        allowedPurposes: unique(rule.allowedPurposes),
        allowedRegions: unique(rule.allowedRegions),
      }])),
    approvals: [...input.approvals]
      .sort((left, right) => compareCanonicalWorkroomText(left.id, right.id))
      .map(value => structuredClone(value)),
  });
}

export function createProjectDataGovernanceAuthority(
  input: ProjectDataGovernanceAuthorityInput,
): ProjectDataGovernanceAuthority {
  assertProjectAuthorityInput(input);
  const { governanceDecision, ...candidateInput } = structuredClone(input);
  const candidate = canonicalizeProjectDataGovernanceAuthorityCandidate(candidateInput);
  if (governanceDecision.candidateDigest !== digest(candidate)) {
    throw new Error('Data Governance decision does not bind the exact authority candidate');
  }
  const body = deepFreeze({
    ...candidate,
    governanceDecision: structuredClone(governanceDecision),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface GovernedSourceAuthorityInput {
  readonly version: 1;
  readonly projectId: string;
  readonly sourceRef: string;
  readonly sourceDigest: string;
  readonly sourceBindingDigest: string;
  readonly descriptor: DataDescriptor;
  readonly handle: PayloadVaultObjectHandle;
  readonly projectAuthorityRevision: number;
  readonly projectAuthorityDigest: string;
}

export interface GovernedSourceAuthority extends GovernedSourceAuthorityInput {
  readonly digest: string;
}

export function createGovernedSourceAuthority(
  input: GovernedSourceAuthorityInput,
): GovernedSourceAuthority {
  requireText(input.projectId, 'source projectId');
  requireText(input.sourceRef, 'source ref');
  requireDigest(input.sourceDigest, 'source digest');
  requireDigest(input.sourceBindingDigest, 'source binding digest');
  requireDigest(input.projectAuthorityDigest, 'source Project authority digest');
  positive(input.projectAuthorityRevision, 'source Project authority revision');
  if (input.descriptor.projectId !== input.projectId
    || input.handle.projectId !== input.projectId
    || input.handle.objectId !== input.descriptor.objectId
    || input.handle.payloadHash !== input.descriptor.payloadHash
    || input.handle.descriptorDigest !== digest(input.descriptor)) {
    throw new Error('Governed source Descriptor/Vault binding is invalid');
  }
  const body = deepFreeze(structuredClone(input));
  return deepFreeze({ ...body, digest: digest(body) });
}

export type DataGovernanceBlockerKind =
  | 'project_authority_unavailable'
  | 'payload_vault_key_unavailable'
  | 'source_classification_quarantined'
  | 'source_authority_conflict'
  | 'disclosure_denied'
  | 'disclosure_approval_required'
  | 'disclosure_manifest_stale'
  | 'disclosure_manifest_expired'
  | 'disclosure_recipient_revoked'
  | 'generation_retired';

export interface DataGovernanceBlockerInput {
  readonly version: 1;
  readonly generation: number;
  readonly operationId: string;
  readonly projectId: string;
  readonly kind: DataGovernanceBlockerKind;
  readonly authorityDigest?: string;
  readonly sourceBindingDigest?: string;
  readonly createdAt: number;
}

export interface DataGovernanceBlocker extends DataGovernanceBlockerInput {
  readonly digest: string;
}

export function createDataGovernanceBlocker(input: DataGovernanceBlockerInput): DataGovernanceBlocker {
  positive(input.generation, 'blocker generation');
  requireText(input.operationId, 'blocker operationId');
  requireText(input.projectId, 'blocker projectId');
  nonNegative(input.createdAt, 'blocker createdAt');
  if (input.authorityDigest !== undefined) requireDigest(input.authorityDigest, 'blocker authority digest');
  if (input.sourceBindingDigest !== undefined) {
    requireDigest(input.sourceBindingDigest, 'blocker source binding digest');
  }
  const body = deepFreeze(structuredClone(input));
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface DataGovernanceAuthorityRepository {
  readProject(projectId: string): Promise<ProjectDataGovernanceAuthority | undefined>;
  /** Resolves an immutable historical authority pinned by an older payload. */
  readProjectRevision?(
    projectId: string,
    revision: number,
  ): Promise<ProjectDataGovernanceAuthority | undefined>;
  appendProject(
    authority: ProjectDataGovernanceAuthority,
    expectedDigest: string | undefined,
  ): Promise<Readonly<{ status: 'created' | 'replayed'; authority: ProjectDataGovernanceAuthority }>>;
  readSource(projectId: string, sourceRef: string, sourceDigest: string): Promise<GovernedSourceAuthority | undefined>;
  appendSource(source: GovernedSourceAuthority): Promise<GovernedSourceAuthority>;
  recordBlocker(input: DataGovernanceBlockerInput): Promise<DataGovernanceBlocker>;
  listBlockers(projectId: string): Promise<readonly DataGovernanceBlocker[]>;
}

/** Trusted Root-only Data Steward/Sponsor decision verifier. */
export interface DataGovernanceAuthorityVerificationPort {
  verify(
    decision: DataGovernanceAuthorityDecision,
    candidateDigest: string,
  ): boolean | Promise<boolean>;
}

export class DataGovernanceAuthorityConflictError extends Error {
  constructor(readonly projectId: string, readonly expected?: string, readonly actual?: string) {
    super(`Data Governance authority conflict for ${projectId}`);
    this.name = 'DataGovernanceAuthorityConflictError';
  }
}

export class DataGovernanceAuthorityUnauthorizedError extends Error {
  constructor(readonly projectId: string, readonly decisionId: string) {
    super(`Data Governance authority decision ${decisionId} is not trusted for ${projectId}`);
    this.name = 'DataGovernanceAuthorityUnauthorizedError';
  }
}

/** Immutable flat-segment repository; its parent must pre-exist. */
export class FileDataGovernanceAuthorityRepository implements DataGovernanceAuthorityRepository {
  readonly #root: DurableFileStore;
  readonly #projects: DurableFileStore;
  readonly #sources: DurableFileStore;
  readonly #blockers: DurableFileStore;
  #ready?: Promise<void>;

  constructor(
    directory: string,
    readonly governance?: DataGovernanceAuthorityVerificationPort,
  ) {
    this.#root = new DurableFileStore(directory);
    this.#projects = new DurableFileStore(join(directory, 'projects'));
    this.#sources = new DurableFileStore(join(directory, 'sources'));
    this.#blockers = new DurableFileStore(join(directory, 'blockers'));
  }

  async readProject(projectId: string): Promise<ProjectDataGovernanceAuthority | undefined> {
    return (await this.#readProjects(projectId)).at(-1);
  }

  async readProjectRevision(
    projectId: string,
    revision: number,
  ): Promise<ProjectDataGovernanceAuthority | undefined> {
    positive(revision, 'Project authority revision');
    return (await this.#readProjects(projectId)).find(authority => authority.revision === revision);
  }

  async #readProjects(projectId: string): Promise<readonly ProjectDataGovernanceAuthority[]> {
    requireText(projectId, 'projectId');
    await this.#ensureReady();
    await this.#projects.syncLeaf();
    const prefix = `${idHash(projectId)}.`;
    const names = (await readdir(this.#projects.directory))
      .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
      .sort();
    const history: ProjectDataGovernanceAuthority[] = [];
    let latest: ProjectDataGovernanceAuthority | undefined;
    for (const [index, name] of names.entries()) {
      const match = /^[a-f\d]{64}\.(\d{12})\.json$/u.exec(name);
      if (!match || Number(match[1]) !== index + 1) {
        throw new DataGovernanceAuthorityConflictError(projectId, latest?.digest);
      }
      const current = parseProjectAuthority(JSON.parse(await readFile(join(this.#projects.directory, name), 'utf8')));
      await this.#verify(current);
      if (current.projectId !== projectId || current.revision !== index + 1
        || current.previousDigest !== latest?.digest) {
        throw new DataGovernanceAuthorityConflictError(projectId, latest?.digest, current.previousDigest);
      }
      latest = current;
      history.push(current);
    }
    return history;
  }

  async appendProject(authority: ProjectDataGovernanceAuthority, expectedDigest: string | undefined) {
    await this.#ensureReady();
    const canonical = parseProjectAuthority(authority);
    await this.#verify(canonical);
    const current = await this.readProject(canonical.projectId);
    if (current?.digest !== expectedDigest) {
      if (current && current.digest === canonical.digest) {
        return Object.freeze({ status: 'replayed' as const, authority: current });
      }
      throw new DataGovernanceAuthorityConflictError(canonical.projectId, expectedDigest, current?.digest);
    }
    if (canonical.revision !== (current?.revision ?? 0) + 1
      || canonical.previousDigest !== current?.digest) {
      throw new DataGovernanceAuthorityConflictError(canonical.projectId, current?.digest, canonical.previousDigest);
    }
    const target = join(this.#projects.directory,
      `${idHash(canonical.projectId)}.${String(canonical.revision).padStart(12, '0')}.json`);
    const result = await this.#projects.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(canonical),
      createdValue: canonical,
      onConflict: async () => {
        const winner = parseProjectAuthority(JSON.parse(await readFile(target, 'utf8')));
        if (winner.digest !== canonical.digest) {
          throw new DataGovernanceAuthorityConflictError(canonical.projectId, canonical.digest, winner.digest);
        }
        return winner;
      },
    });
    return Object.freeze({ status: result.status, authority: result.value });
  }

  async readSource(
    projectId: string,
    sourceRef: string,
    sourceDigest: string,
  ): Promise<GovernedSourceAuthority | undefined> {
    await this.#ensureReady();
    await this.#sources.syncLeaf();
    const target = this.#sourcePath(projectId, sourceRef, sourceDigest);
    try {
      return parseGovernedSource(JSON.parse(await readFile(target, 'utf8')));
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return undefined;
      throw error;
    }
  }

  async appendSource(source: GovernedSourceAuthority): Promise<GovernedSourceAuthority> {
    await this.#ensureReady();
    const canonical = parseGovernedSource(source);
    const target = this.#sourcePath(canonical.projectId, canonical.sourceRef, canonical.sourceDigest);
    const result = await this.#sources.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(canonical),
      createdValue: canonical,
      onConflict: async () => {
        const winner = parseGovernedSource(JSON.parse(await readFile(target, 'utf8')));
        if (winner.digest !== canonical.digest) {
          throw new DataGovernanceAuthorityConflictError(canonical.projectId, canonical.digest, winner.digest);
        }
        return winner;
      },
    });
    return result.value;
  }

  async recordBlocker(input: DataGovernanceBlockerInput): Promise<DataGovernanceBlocker> {
    await this.#ensureReady();
    const blocker = createDataGovernanceBlocker(input);
    const target = join(this.#blockers.directory,
      `${idHash(blocker.projectId)}.${blocker.digest.slice('sha256:'.length)}.json`);
    const result = await this.#blockers.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(blocker),
      createdValue: blocker,
      onConflict: async () => parseBlocker(JSON.parse(await readFile(target, 'utf8'))),
    });
    if (result.value.digest !== blocker.digest) {
      throw new DataGovernanceAuthorityConflictError(blocker.projectId, blocker.digest, result.value.digest);
    }
    return result.value;
  }

  async listBlockers(projectId: string): Promise<readonly DataGovernanceBlocker[]> {
    await this.#ensureReady();
    await this.#blockers.syncLeaf();
    const prefix = `${idHash(projectId)}.`;
    const values: DataGovernanceBlocker[] = [];
    for (const name of (await readdir(this.#blockers.directory)).filter(value => value.startsWith(prefix)).sort()) {
      const blocker = parseBlocker(JSON.parse(await readFile(join(this.#blockers.directory, name), 'utf8')));
      if (blocker.projectId !== projectId) throw new DataGovernanceAuthorityConflictError(projectId);
      values.push(blocker);
    }
    return deepFreeze(values.sort((left, right) => left.createdAt - right.createdAt
      || compareCanonicalWorkroomText(left.digest, right.digest)));
  }

  #sourcePath(projectId: string, sourceRef: string, sourceDigest: string): string {
    requireText(projectId, 'source projectId');
    requireText(sourceRef, 'source ref');
    requireDigest(sourceDigest, 'source digest');
    return join(this.#sources.directory, `${idHash(`${projectId}\0${sourceRef}\0${sourceDigest}`)}.json`);
  }

  async #verify(authority: ProjectDataGovernanceAuthority): Promise<void> {
    if (!this.governance
      || !await this.governance.verify(
        authority.governanceDecision,
        authority.governanceDecision.candidateDigest,
      )) {
      throw new DataGovernanceAuthorityUnauthorizedError(
        authority.projectId,
        authority.governanceDecision.decisionId,
      );
    }
  }

  #ensureReady(): Promise<void> {
    this.#ready ??= (async () => {
      await this.#root.ensureDurableLeaf('Data Governance authority repository');
      await this.#projects.ensureDurableLeaf('Data Governance Project authority repository');
      await this.#sources.ensureDurableLeaf('Data Governance source authority repository');
      await this.#blockers.ensureDurableLeaf('Data Governance blocker repository');
      await this.#root.syncLeafAndParent();
    })();
    return this.#ready;
  }
}

function parseProjectAuthority(value: unknown): ProjectDataGovernanceAuthority {
  if (!value || typeof value !== 'object') throw new Error('Data Governance Project authority is malformed');
  const { digest: actualDigest, ...input } = value as ProjectDataGovernanceAuthority;
  const canonical = createProjectDataGovernanceAuthority(input);
  if (actualDigest !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Data Governance Project authority digest mismatch');
  }
  return canonical;
}

function parseGovernedSource(value: unknown): GovernedSourceAuthority {
  if (!value || typeof value !== 'object') throw new Error('Governed source authority is malformed');
  const { digest: actualDigest, ...input } = value as GovernedSourceAuthority;
  const canonical = createGovernedSourceAuthority(input);
  if (actualDigest !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Governed source authority digest mismatch');
  }
  return canonical;
}

function parseBlocker(value: unknown): DataGovernanceBlocker {
  if (!value || typeof value !== 'object') throw new Error('Data Governance blocker is malformed');
  const { digest: actualDigest, ...input } = value as DataGovernanceBlocker;
  const canonical = createDataGovernanceBlocker(input);
  if (actualDigest !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Data Governance blocker digest mismatch');
  }
  return canonical;
}

function assertProjectAuthorityInput(input: ProjectDataGovernanceAuthorityInput): void {
  if (input.version !== 1) throw new Error('Data Governance Project authority version is invalid');
  positive(input.revision, 'Project authority revision');
  if (input.revision === 1 ? input.previousDigest !== undefined : input.previousDigest === undefined) {
    throw new Error('Data Governance Project authority chain is invalid');
  }
  if (input.previousDigest !== undefined) requireDigest(input.previousDigest, 'previous digest');
  requireText(input.projectId, 'projectId');
  requireText(input.tenantId, 'tenantId');
  assertDataCategoryRegistrySnapshot(input.categoryRegistry);
  assertDataGovernancePolicySnapshot(input.policy);
  if (input.categoryRegistry.tenantId !== input.tenantId
    || input.policy.tenantId !== input.tenantId
    || input.policy.projectId !== input.projectId) {
    throw new Error('Data Governance Project authority tenant/Project scope mismatch');
  }
  const destination = input.policy.destinations[input.planning.destinationId];
  if (!destination) throw new Error('Planning Processing Destination is absent from Data Governance Policy');
  assertDisclosureRecipientSetSnapshot(input.planning.recipients);
  if (destination.recipientSnapshotRevision !== input.planning.recipients.revision
    || destination.recipientSnapshotDigest !== input.planning.recipients.digest) {
    throw new Error('Planning recipient snapshot does not match Processing Destination');
  }
  for (const [destinationId, rule] of Object.entries(input.remote)) {
    const remoteDestination = input.policy.destinations[destinationId];
    if (!remoteDestination) throw new Error(`Remote Processing Destination ${destinationId} is absent from Policy`);
    assertDisclosureRecipientSetSnapshot(rule.recipients);
    if (remoteDestination.recipientSnapshotRevision !== rule.recipients.revision
      || remoteDestination.recipientSnapshotDigest !== rule.recipients.digest
      || !rule.principal.allowedPurposes.includes('remote_execution')) {
      throw new Error(`Remote disclosure rule ${destinationId} is outside its Destination authority`);
    }
  }
  for (const [ruleId, rule] of Object.entries(input.sinks)) {
    requireText(ruleId, 'sink rule id');
    const sinkDestination = input.policy.destinations[rule.destinationId];
    if (!sinkDestination || !rule.principal.allowedPurposes.includes(rule.purpose)) {
      throw new Error(`Disclosure sink rule ${ruleId} is outside its policy authority`);
    }
    assertDisclosureRecipientSetSnapshot(rule.recipients);
    if (sinkDestination.recipientSnapshotRevision !== rule.recipients.revision
      || sinkDestination.recipientSnapshotDigest !== rule.recipients.digest) {
      throw new Error(`Disclosure sink rule ${ruleId} recipient authority drift`);
    }
    if (rule.fixedPrincipalId !== undefined) requireText(rule.fixedPrincipalId, 'fixed sink principal');
  }
  for (const [kind, rule] of Object.entries(input.derivedPayloads)) {
    if (kind !== 'evidence' && kind !== 'taskReport' && kind !== 'projection'
      && kind !== 'acceptanceProjection' && kind !== 'journal') {
      throw new Error(`Unknown governed derived payload rule ${kind}`);
    }
    if (!['public', 'project_internal', 'confidential', 'restricted']
      .includes(rule.proposedConfidentiality)) {
      throw new Error(`Governed derived payload rule ${kind} confidentiality is invalid`);
    }
    if (!['transient', 'operational', 'project_record', 'regulated_record']
      .includes(rule.retentionClass)) {
      throw new Error(`Governed derived payload rule ${kind} retention class is invalid`);
    }
    unique(rule.categories);
    unique(rule.allowedPurposes);
    unique(rule.allowedRegions);
    nonNegative(rule.minimumRetentionMs, `${kind} minimum retention`);
    positive(rule.maximumRetentionMs, `${kind} maximum retention`);
    if (rule.maximumRetentionMs < rule.minimumRetentionMs) {
      throw new Error(`Governed derived payload rule ${kind} retention window is invalid`);
    }
  }
  if (!['orchestrator', 'executor', 'reviewer', 'sponsor', 'auditor', 'projector']
    .includes(input.planning.principal.role)) {
    throw new Error('Planning principal role is invalid');
  }
  unique(input.planning.principal.allowedPurposes);
  unique(input.planning.source.categories);
  unique(input.planning.source.allowedPurposes);
  unique(input.planning.source.allowedRegions);
  nonNegative(input.planning.source.minimumRetentionMs, 'minimum retention');
  positive(input.planning.source.maximumRetentionMs, 'maximum retention');
  if (input.planning.source.maximumRetentionMs < input.planning.source.minimumRetentionMs) {
    throw new Error('Planning source retention window is invalid');
  }
  for (const approval of input.approvals) {
    requireText(approval.id, 'approval id');
    requireDigest(approval.requestDigest, 'approval request digest');
    positive(approval.policyRevision, 'approval policy revision');
    nonNegative(approval.expiresAt, 'approval expiry');
  }
  const decision = input.governanceDecision;
  requireText(decision.decisionId, 'governance decision id');
  requireText(decision.principalId, 'governance decision principal');
  requireDigest(decision.candidateDigest, 'governance decision candidate digest');
  nonNegative(decision.decidedAt, 'governance decision timestamp');
  if ((decision.catalogRevision === undefined) !== (decision.catalogBindingDigest === undefined)) {
    throw new Error('Data Governance decision Catalog binding is incomplete');
  }
  if (decision.catalogRevision !== undefined) {
    requireText(decision.catalogRevision, 'governance decision Catalog revision');
    requireDigest(decision.catalogBindingDigest, 'governance decision Catalog binding digest');
  }
  if (decision.authorizedBy !== 'data_steward' && decision.authorizedBy !== 'sponsor') {
    throw new Error('Data Governance decision authority role is invalid');
  }
  if (decision.projectId !== input.projectId
    || decision.expectedPreviousDigest !== input.previousDigest) {
    throw new Error('Data Governance decision scope/chain binding mismatch');
  }
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('Data Governance authority contains invalid canonical names');
  }
  return Object.freeze([...new Set(values)].sort()) as readonly T[];
}

function idHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Data Governance ${label} is invalid`);
  }
}

function requireDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f\d]{64}$/u.test(value)) {
    throw new Error(`Data Governance ${label} is invalid`);
  }
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`Data Governance ${label} is invalid`);
  return Number(value);
}

function nonNegative(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Data Governance ${label} is invalid`);
  return Number(value);
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
