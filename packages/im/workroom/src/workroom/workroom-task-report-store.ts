import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  WorkroomAcceptedReportReadInput,
  WorkroomAcceptedReportReader,
} from './accepted-source-memory-application.js';
import type {
  WorkroomStructuredReportClaim,
  WorkroomStructuredTaskReport,
} from './accepted-source-projector.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import { DurableFileStore } from './durable-file-store.js';
import type {
  GovernedPayloadPublicationVerification,
  GovernedPayloadWriteSagaSnapshot,
} from '../data-governance/governed-payload-write-saga.js';

export interface WorkroomGovernedPayloadReceipt {
  readonly descriptor: Readonly<{
    vaultObjectId: string;
    objectId: string;
    payloadHash: string;
    descriptorDigest: string;
    locationManifestDigest: string;
    bytes: number;
  }>;
  readonly source: Readonly<{
    kind: 'command' | 'file' | 'url' | 'tool' | 'human';
    ref: string;
    digest: string;
    bindingDigest: string;
    verification: 'verified' | 'unverified';
  }>;
}

export interface WorkroomGovernedPayloadPublicationResult {
  readonly publicationDigest: string;
}

/**
 * Short-lived inverse port owned by the durable header repository. Payload
 * bodies and raw Vault access never cross this boundary.
 */
export interface WorkroomGovernedPayloadPublicationPort {
  publish(
    receipt: WorkroomGovernedPayloadReceipt,
    signal: AbortSignal,
  ): Promise<WorkroomGovernedPayloadPublicationResult>;
}

/** Exact create-only header conflict; the prepared payload must be purged. */
export class WorkroomGovernedPayloadHeaderCasLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkroomGovernedPayloadHeaderCasLostError';
  }
}

/** Header repository proved no durable header was published. */
export class WorkroomGovernedPayloadPublicationAbandonedError extends Error {
  readonly reason = 'write_failed' as const;

  constructor(message: string) {
    super(message);
    this.name = 'WorkroomGovernedPayloadPublicationAbandonedError';
  }
}

export interface WorkroomEvidenceInput extends WorkroomGovernedPayloadReceipt {
  readonly mediaType: string;
}

export interface WorkroomEvidence extends WorkroomEvidenceInput {
  readonly version: 1;
  readonly ref: string;
  readonly digest: string;
}

export interface WorkroomStructuredTaskReportInput {
  readonly projectId: string;
  readonly runId: string;
  readonly planRef: string;
  readonly planRevision: number;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentAttempt: number;
  readonly assignmentFence: number;
  readonly claims: readonly WorkroomStructuredTaskReportClaimInput[];
}

export interface WorkroomStructuredTaskReportClaimInput
  extends Omit<WorkroomStructuredReportClaim, 'id'> {
  /** Untrusted producer label. It is governed payload content, never a durable header identifier. */
  readonly label: string;
}

export interface PersistedWorkroomStructuredReportClaim extends WorkroomStructuredReportClaim {
  /** Untrusted producer label retained only inside the governed Task Report payload. */
  readonly label: string;
}

export interface PersistedWorkroomStructuredTaskReport extends WorkroomStructuredTaskReport {
  readonly version: 2;
  readonly assignmentId: string;
  readonly assignmentAttempt: number;
  readonly assignmentFence: number;
  /** Digest of the normalized producer report before host claim identifiers are assigned. */
  readonly reportDigest: string;
  readonly claims: readonly PersistedWorkroomStructuredReportClaim[];
  readonly digest: string;
}

export interface WorkroomTaskReportPayloadWriteInput {
  readonly report: PersistedWorkroomStructuredTaskReport;
  readonly attribution: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    taskRevision: number;
  }>;
  readonly publication: WorkroomGovernedPayloadPublicationPort;
}

export interface WorkroomTaskReportPayloadReadInput {
  readonly receipt: WorkroomGovernedPayloadReceipt;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly reportRef: string;
  readonly candidateHash: string;
  readonly purpose: 'accepted-source-memory-projector' | 'acceptance-evaluation' | 'acceptance-review';
}

/** Governed derived-payload boundary; implementations own disclosure/read authority. */
export interface WorkroomTaskReportPayloadPort {
  write(
    input: WorkroomTaskReportPayloadWriteInput,
    signal: AbortSignal,
  ): Promise<WorkroomGovernedPayloadReceipt>;
  read(
    input: WorkroomTaskReportPayloadReadInput,
    signal: AbortSignal,
  ): Promise<PersistedWorkroomStructuredTaskReport>;
}

export interface WorkroomTaskReportStore extends WorkroomAcceptedReportReader {
  writeEvidence(evidence: WorkroomEvidence): Promise<Readonly<{ ref: string; digest: string }>>;
  writeReport(
    report: PersistedWorkroomStructuredTaskReport,
  ): Promise<Readonly<{ ref: string; digest: string }>>;
}

interface WorkroomTaskReportClaimHeader {
  readonly claimId: string;
  readonly status: WorkroomStructuredReportClaim['status'];
  readonly evidenceRefs: readonly string[];
}

interface PersistedWorkroomTaskReportHeader {
  readonly version: 2;
  readonly ref: string;
  readonly candidateHash: string;
  readonly projectId: string;
  readonly runId: string;
  readonly planRef: string;
  readonly planRevision: number;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentAttempt: number;
  readonly assignmentFence: number;
  readonly reportDigest: string;
  readonly claims: readonly WorkroomTaskReportClaimHeader[];
  readonly payload: WorkroomGovernedPayloadReceipt;
  readonly digest: string;
}

export function createWorkroomEvidence(input: WorkroomEvidenceInput): WorkroomEvidence {
  const governed = assertGovernedPayloadReceipt(input);
  const projection = deepFreeze({
    version: 1 as const,
    mediaType: requiredText(input.mediaType, 'Evidence mediaType'),
    descriptor: deepFreeze({
      ...governed.descriptor,
    }),
    source: deepFreeze({
      ...governed.source,
    }),
  });
  const contentDigest = digest(projection);
  return deepFreeze({
    ...projection,
    ref: `workroom-evidence:${contentDigest}`,
    digest: contentDigest,
  });
}

export function createWorkroomStructuredTaskReport(
  input: WorkroomStructuredTaskReportInput,
): PersistedWorkroomStructuredTaskReport {
  const attribution = deepFreeze({
    projectId: requiredText(input.projectId, 'Report projectId'),
    runId: requiredText(input.runId, 'Report runId'),
    planRef: requiredText(input.planRef, 'Report planRef'),
    planRevision: positiveInteger(input.planRevision, 'Report planRevision'),
    taskKey: requiredText(input.taskKey, 'Report taskKey'),
    taskRevision: positiveInteger(input.taskRevision, 'Report taskRevision'),
    assignmentId: requiredText(input.assignmentId, 'Report assignmentId'),
    assignmentAttempt: positiveInteger(input.assignmentAttempt, 'Report assignmentAttempt'),
    assignmentFence: positiveInteger(input.assignmentFence, 'Report assignmentFence'),
  });
  const sourceClaims = normalizeClaimInputs(input.claims);
  const reportDigest = digest(deepFreeze({
    version: 1 as const,
    ...attribution,
    claims: sourceClaims,
  }));
  const claims = Object.freeze(sourceClaims.map((claim, ordinal) => deepFreeze({
    id: canonicalClaimId(attribution, reportDigest, ordinal),
    ...claim,
  })));
  const body = deepFreeze({
    version: 2 as const,
    ...attribution,
    reportDigest,
    claims,
  });
  const candidateHash = digest(body);
  const projection = deepFreeze({
    ...body,
    ref: `workroom-report:${candidateHash}`,
    candidateHash,
  });
  return deepFreeze({ ...projection, digest: digest(projection) });
}

function createReportHeader(
  report: PersistedWorkroomStructuredTaskReport,
  payload: WorkroomGovernedPayloadReceipt,
): PersistedWorkroomTaskReportHeader {
  const body = deepFreeze({
    version: 2 as const,
    ref: report.ref,
    candidateHash: report.candidateHash,
    projectId: report.projectId,
    runId: report.runId,
    planRef: report.planRef,
    planRevision: report.planRevision,
    taskKey: report.taskKey,
    taskRevision: report.taskRevision,
    assignmentId: report.assignmentId,
    assignmentAttempt: report.assignmentAttempt,
    assignmentFence: report.assignmentFence,
    reportDigest: report.reportDigest,
    claims: Object.freeze(report.claims.map(claim => deepFreeze({
      claimId: claim.id,
      status: claim.status,
      evidenceRefs: claim.evidenceRefs,
    }))),
    payload: assertGovernedPayloadReceipt(payload),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function assertReportHeader(value: PersistedWorkroomTaskReportHeader): PersistedWorkroomTaskReportHeader {
  if (!value || typeof value !== 'object' || value.version !== 2) {
    throw new Error('Workroom Task Report header version is invalid');
  }
  const body = deepFreeze({
    version: 2 as const,
    ref: requiredText(value.ref, 'Report header ref'),
    candidateHash: requiredDigest(value.candidateHash, 'Report header candidate hash'),
    projectId: requiredText(value.projectId, 'Report header projectId'),
    runId: requiredText(value.runId, 'Report header runId'),
    planRef: requiredText(value.planRef, 'Report header planRef'),
    planRevision: positiveInteger(value.planRevision, 'Report header planRevision'),
    taskKey: requiredText(value.taskKey, 'Report header taskKey'),
    taskRevision: positiveInteger(value.taskRevision, 'Report header taskRevision'),
    assignmentId: requiredText(value.assignmentId, 'Report header assignmentId'),
    assignmentAttempt: positiveInteger(value.assignmentAttempt, 'Report header assignmentAttempt'),
    assignmentFence: positiveInteger(value.assignmentFence, 'Report header assignmentFence'),
    reportDigest: requiredDigest(value.reportDigest, 'Report header report digest'),
    claims: normalizeClaimHeaders(value.claims),
    payload: assertGovernedPayloadReceipt(value.payload),
  });
  if (body.ref !== `workroom-report:${body.candidateHash}`) {
    throw new Error('Workroom Task Report header ref does not bind candidate hash');
  }
  body.claims.forEach((claim, ordinal) => {
    const expected = canonicalClaimId(body, body.reportDigest, ordinal);
    if (claim.claimId !== expected) {
      throw new Error(`Workroom Task Report header claim ${claim.claimId} is not host canonical`);
    }
  });
  const canonical = deepFreeze({ ...body, digest: digest(body) });
  if (value.digest !== canonical.digest
    || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Workroom Task Report header digest drift');
  }
  return canonical;
}

function assertReportMatchesHeader(
  report: PersistedWorkroomStructuredTaskReport,
  header: PersistedWorkroomTaskReportHeader,
): void {
  const projected = createReportHeader(report, header.payload);
  if (canonicalWorkroomJson(projected) !== canonicalWorkroomJson(header)) {
    throw new Error('Governed Workroom Task Report payload does not match persisted header');
  }
}

/** Crash-durable content-addressed source for completion and accepted-source memory. */
export class FileWorkroomTaskReportStore implements WorkroomTaskReportStore {
  readonly #root: DurableFileStore;
  readonly #reports: DurableFileStore;
  readonly #evidence: DurableFileStore;
  readonly #payloads: WorkroomTaskReportPayloadPort;
  readonly #signal: AbortSignal;

  constructor(
    readonly directory: string,
    payloads: WorkroomTaskReportPayloadPort,
    signal: AbortSignal = new AbortController().signal,
  ) {
    this.#root = new DurableFileStore(directory);
    this.#reports = new DurableFileStore(join(directory, 'reports'));
    this.#evidence = new DurableFileStore(join(directory, 'evidence'));
    this.#payloads = payloads;
    this.#signal = signal;
  }

  /** Content-free generation handoff verifier; it never materializes payload bodies. */
  async verifyGovernedPayloadPublication(
    intent: GovernedPayloadWriteSagaSnapshot,
  ): Promise<GovernedPayloadPublicationVerification> {
    if (intent.consumer === 'task_report_header') {
      if (!intent.publicationScope?.startsWith('workroom-report:')) return { status: 'missing' };
      try {
        const header = await this.#readReportHeader(intent.publicationScope);
        return receiptMatchesIntent(header.payload, intent)
          ? deepFreeze({ status: 'exact' as const, publicationDigest: header.digest })
          : deepFreeze({ status: 'missing' as const });
      } catch {
        return deepFreeze({ status: 'missing' as const });
      }
    }
    if (intent.consumer !== 'evidence_header') return deepFreeze({ status: 'unknown' as const });
    let names: string[];
    try {
      names = (await readdir(this.#evidence.directory)).filter(name => name.endsWith('.json')).sort();
    } catch (error) {
      return hasCode(error, 'ENOENT')
        ? deepFreeze({ status: 'missing' as const })
        : deepFreeze({ status: 'unknown' as const });
    }
    for (const name of names) {
      try {
        const evidence = assertEvidence(JSON.parse(await readFile(
          join(this.#evidence.directory, name),
          'utf8',
        )) as WorkroomEvidence);
        if (receiptMatchesIntent(evidence, intent)) {
          return deepFreeze({ status: 'exact' as const, publicationDigest: evidence.digest });
        }
      } catch {
        return deepFreeze({ status: 'unknown' as const });
      }
    }
    return deepFreeze({ status: 'missing' as const });
  }

  async writeEvidence(
    evidence: WorkroomEvidence,
  ): Promise<Readonly<{ ref: string; digest: string }>> {
    const canonical = assertEvidence(evidence);
    await this.#ensureDirectories();
    const target = join(this.#evidence.directory, `${canonical.digest.slice(7)}.json`);
    await this.#evidence.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(canonical),
      createdValue: canonical,
      onConflict: async () => {
        let existing: WorkroomEvidence;
        try {
          existing = await this.#readEvidence(canonical.ref);
        } catch {
          throw new WorkroomGovernedPayloadHeaderCasLostError(
            `Workroom Evidence content address collision: ${canonical.ref}`,
          );
        }
        if (canonicalWorkroomJson(existing) !== canonicalWorkroomJson(canonical)) {
          throw new WorkroomGovernedPayloadHeaderCasLostError(
            `Workroom Evidence content address collision: ${canonical.ref}`,
          );
        }
        return existing;
      },
    });
    return deepFreeze({ ref: canonical.ref, digest: canonical.digest });
  }

  async writeReport(
    report: PersistedWorkroomStructuredTaskReport,
  ): Promise<Readonly<{ ref: string; digest: string }>> {
    const canonical = assertReport(report);
    this.#signal.throwIfAborted();
    await this.#ensureDirectories();
    for (const claim of canonical.claims) {
      if (claim.status !== 'verified') continue;
      for (const evidenceRef of claim.evidenceRefs) {
        try {
          await this.#readEvidence(evidenceRef);
        } catch (error) {
          if (hasCode(error, 'ENOENT')) {
            throw new Error(`Evidence is not durably published: ${evidenceRef}`, { cause: error });
          }
          throw error;
        }
      }
    }
    const target = join(this.#reports.directory, `${canonical.candidateHash.slice(7)}.json`);
    let publishedHeader: PersistedWorkroomTaskReportHeader | undefined;
    const payload = assertGovernedPayloadReceipt(await this.#payloads.write({
      report: canonical,
      attribution: deepFreeze({
        projectId: canonical.projectId,
        runId: canonical.runId,
        taskKey: canonical.taskKey,
        taskRevision: canonical.taskRevision,
      }),
      publication: Object.freeze({
        publish: async (
          candidate: WorkroomGovernedPayloadReceipt,
          signal: AbortSignal,
        ) => {
          signal.throwIfAborted();
          const governed = assertGovernedPayloadReceipt(candidate);
          if (governed.source.verification !== 'verified') {
            throw new WorkroomGovernedPayloadPublicationAbandonedError(
              'Governed Workroom Task Report payload lacks verified source lineage',
            );
          }
          const header = createReportHeader(canonical, governed);
          await this.#reports.publishCreateOnly({
            target,
            content: canonicalWorkroomJson(header),
            createdValue: header,
            onConflict: async () => {
              const existing = await this.#readReportHeader(canonical.ref);
              if (canonicalWorkroomJson(existing) !== canonicalWorkroomJson(header)) {
                throw new WorkroomGovernedPayloadHeaderCasLostError(
                  `Workroom Task Report content address collision: ${canonical.ref}`,
                );
              }
              return existing;
            },
          });
          publishedHeader = header;
          return deepFreeze({ publicationDigest: header.digest });
        },
      }),
    }, this.#signal));
    if (!publishedHeader) {
      throw new Error('Governed Workroom Task Report Writer did not publish the durable header');
    }
    const header = publishedHeader;
    if (canonicalWorkroomJson(header.payload) !== canonicalWorkroomJson(payload)) {
      throw new Error('Governed Workroom Task Report publication receipt drift');
    }
    return deepFreeze({ ref: canonical.ref, digest: header.digest });
  }

  async read(
    input: WorkroomAcceptedReportReadInput,
  ): Promise<PersistedWorkroomStructuredTaskReport | undefined> {
    let header: PersistedWorkroomTaskReportHeader;
    try {
      header = await this.#readReportHeader(requiredText(input.reportRef, 'Report ref'));
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return undefined;
      throw error;
    }
    if (header.projectId !== input.projectId
      || header.runId !== input.runId
      || header.taskKey !== input.taskKey
      || header.candidateHash !== input.candidateHash) {
      throw new Error('Workroom Task Report read authority scope does not match persisted content');
    }
    this.#signal.throwIfAborted();
    const report = assertReport(await this.#payloads.read({
      receipt: header.payload,
      projectId: header.projectId,
      runId: header.runId,
      taskKey: header.taskKey,
      reportRef: header.ref,
      candidateHash: header.candidateHash,
      purpose: input.purpose ?? 'accepted-source-memory-projector',
    }, this.#signal));
    assertReportMatchesHeader(report, header);
    return report;
  }

  async #ensureDirectories(): Promise<void> {
    await this.#root.ensureDurableLeaf('Workroom Task Report Store');
    await this.#reports.ensureDurableLeaf('Workroom Task Report Store reports');
    await this.#evidence.ensureDurableLeaf('Workroom Task Report Store evidence');
  }

  async #readEvidence(ref: string): Promise<WorkroomEvidence> {
    const contentHash = contentAddress(ref, 'workroom-evidence');
    return assertEvidence(JSON.parse(await readFile(
      join(this.#evidence.directory, `${contentHash.slice(7)}.json`),
      'utf8',
    )) as WorkroomEvidence);
  }

  async #readReportHeader(ref: string): Promise<PersistedWorkroomTaskReportHeader> {
    const contentHash = contentAddress(ref, 'workroom-report');
    return assertReportHeader(JSON.parse(await readFile(
      join(this.#reports.directory, `${contentHash.slice(7)}.json`),
      'utf8',
    )) as PersistedWorkroomTaskReportHeader);
  }
}

function assertEvidence(value: WorkroomEvidence): WorkroomEvidence {
  const canonical = createWorkroomEvidence(value);
  if (value.ref !== canonical.ref || value.digest !== canonical.digest
    || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Workroom Evidence content address or digest drift');
  }
  return canonical;
}

function assertReport(
  value: PersistedWorkroomStructuredTaskReport,
): PersistedWorkroomStructuredTaskReport {
  if (!value || typeof value !== 'object' || value.version !== 2) {
    throw new Error('Workroom Task Report payload version is invalid');
  }
  const canonical = createWorkroomStructuredTaskReport({
    projectId: value.projectId,
    runId: value.runId,
    planRef: value.planRef,
    planRevision: value.planRevision,
    taskKey: value.taskKey,
    taskRevision: value.taskRevision,
    assignmentId: value.assignmentId,
    assignmentAttempt: value.assignmentAttempt,
    assignmentFence: value.assignmentFence,
    claims: value.claims.map(claim => ({
      label: claim.label,
      key: claim.key,
      value: claim.value,
      status: claim.status,
      evidenceRefs: claim.evidenceRefs,
      artifactRefs: claim.artifactRefs,
      ...(claim.validUntil === undefined ? {} : { validUntil: claim.validUntil }),
      ...(claim.supersedesFactIds === undefined
        ? {}
        : { supersedesFactIds: claim.supersedesFactIds }),
    })),
  });
  if (value.ref !== canonical.ref
    || value.candidateHash !== canonical.candidateHash
    || value.reportDigest !== canonical.reportDigest
    || value.digest !== canonical.digest
    || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Workroom Task Report content address or digest drift');
  }
  return canonical;
}

function normalizeClaimInputs(
  claims: readonly WorkroomStructuredTaskReportClaimInput[],
): readonly WorkroomStructuredTaskReportClaimInput[] {
  if (!Array.isArray(claims)) throw new Error('Report claims must be an array');
  const labels = new Set<string>();
  const normalized = claims.map((claim, ordinal) => {
    const claimPath = `Report claim at ordinal ${ordinal}`;
    const label = requiredText(claim.label, 'Report claim label');
    if (labels.has(label)) throw new Error('Workroom Task Report contains duplicate producer claim labels');
    labels.add(label);
    if (claim.status !== 'verified' && claim.status !== 'assumed') {
      throw new Error(`${claimPath} status is invalid`);
    }
    const evidenceRefs = textSet(claim.evidenceRefs, `${claimPath} evidenceRefs`);
    if (claim.status === 'verified' && evidenceRefs.length === 0) {
      throw new Error(`Verified ${claimPath} requires evidence`);
    }
    const validUntil = claim.validUntil === undefined
      ? undefined
      : nonNegativeInteger(claim.validUntil, `${claimPath} validUntil`);
    return deepFreeze({
      label,
      key: requiredText(claim.key, `${claimPath} key`),
      value: requiredText(claim.value, `${claimPath} value`),
      status: claim.status,
      evidenceRefs,
      artifactRefs: textSet(claim.artifactRefs, `${claimPath} artifactRefs`),
      ...(validUntil === undefined ? {} : { validUntil }),
      ...(claim.supersedesFactIds === undefined
        ? {}
        : { supersedesFactIds: textSet(claim.supersedesFactIds, `${claimPath} supersedes`) }),
    });
  });
  return Object.freeze(normalized);
}

function normalizeClaimHeaders(
  claims: readonly WorkroomTaskReportClaimHeader[],
): readonly WorkroomTaskReportClaimHeader[] {
  if (!Array.isArray(claims)) throw new Error('Report header claims must be an array');
  const ids = new Set<string>();
  return Object.freeze(claims.map((claim) => {
    const claimId = requiredClaimId(claim?.claimId, 'Report header claim id');
    if (ids.has(claimId)) throw new Error(`Duplicate Workroom Task Report header claim ${claimId}`);
    ids.add(claimId);
    if (claim.status !== 'verified' && claim.status !== 'assumed') {
      throw new Error(`Workroom Task Report header claim ${claimId} status is invalid`);
    }
    return deepFreeze({
      claimId,
      status: claim.status,
      evidenceRefs: textSet(claim.evidenceRefs, `Report header claim ${claimId} evidenceRefs`),
    });
  }));
}

function canonicalClaimId(
  attribution: Readonly<{
    projectId: string;
    runId: string;
    taskKey: string;
    taskRevision: number;
    assignmentId: string;
    assignmentAttempt: number;
    assignmentFence: number;
  }>,
  reportDigest: string,
  ordinal: number,
): string {
  return `workroom-claim:${digest(deepFreeze({
    version: 1 as const,
    projectId: attribution.projectId,
    runId: attribution.runId,
    taskKey: attribution.taskKey,
    taskRevision: attribution.taskRevision,
    assignmentId: attribution.assignmentId,
    assignmentAttempt: attribution.assignmentAttempt,
    assignmentFence: attribution.assignmentFence,
    reportDigest: requiredDigest(reportDigest, 'Report digest for canonical claim id'),
    ordinal: nonNegativeInteger(ordinal, 'Report claim ordinal'),
  }))}`;
}

function assertGovernedPayloadReceipt(
  value: WorkroomGovernedPayloadReceipt,
): WorkroomGovernedPayloadReceipt {
  if (!value || typeof value !== 'object') {
    throw new Error('Governed Workroom payload receipt is missing');
  }
  return deepFreeze({
    descriptor: deepFreeze({
      vaultObjectId: requiredText(value.descriptor?.vaultObjectId, 'Payload Vault object id'),
      objectId: requiredText(value.descriptor?.objectId, 'Payload object id'),
      payloadHash: requiredDigest(value.descriptor?.payloadHash, 'Payload hash'),
      descriptorDigest: requiredDigest(value.descriptor?.descriptorDigest, 'Payload descriptor digest'),
      locationManifestDigest: requiredDigest(
        value.descriptor?.locationManifestDigest,
        'Payload location manifest digest',
      ),
      bytes: nonNegativeInteger(value.descriptor?.bytes, 'Payload bytes'),
    }),
    source: deepFreeze({
      kind: evidenceSourceKind(value.source?.kind),
      ref: requiredText(value.source?.ref, 'Payload canonical source ref'),
      digest: requiredDigest(value.source?.digest, 'Payload canonical source digest'),
      bindingDigest: requiredDigest(value.source?.bindingDigest, 'Payload source binding digest'),
      verification: evidenceVerification(value.source?.verification),
    }),
  });
}

function contentAddress(ref: string, kind: 'workroom-evidence' | 'workroom-report'): string {
  const prefix = `${kind}:`;
  if (!ref.startsWith(prefix) || !/^sha256:[a-f0-9]{64}$/u.test(ref.slice(prefix.length))) {
    throw new Error(`${kind} ref is not a canonical content address`);
  }
  return ref.slice(prefix.length);
}

function textSet(value: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = value.map(item => requiredText(item, label));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return Object.freeze([...result].sort());
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} requires canonical non-empty text`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return Number(value);
}

function requiredDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function requiredClaimId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^workroom-claim:sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a host-generated canonical Workroom claim id`);
  }
  return value;
}

function evidenceSourceKind(value: unknown): WorkroomEvidenceInput['source']['kind'] {
  if (!['command', 'file', 'url', 'tool', 'human'].includes(String(value))) {
    throw new Error('Evidence source kind is invalid');
  }
  return value as WorkroomEvidenceInput['source']['kind'];
}

function evidenceVerification(value: unknown): WorkroomEvidenceInput['source']['verification'] {
  if (value !== 'verified' && value !== 'unverified') {
    throw new Error('Evidence source verification is invalid');
  }
  return value;
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}

function receiptMatchesIntent(
  receipt: WorkroomGovernedPayloadReceipt,
  intent: GovernedPayloadWriteSagaSnapshot,
): boolean {
  return receipt.descriptor.objectId === intent.objectId
    && receipt.descriptor.payloadHash === intent.payloadHash
    && receipt.descriptor.descriptorDigest === intent.descriptorDigest
    && receipt.source.bindingDigest === intent.sourceBindingDigest;
}
