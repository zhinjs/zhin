import {
  assertPersistedAcceptanceRecord,
  type WorkroomAcceptanceRecord,
} from './acceptance-policy.js';
import {
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';

export type WorkroomClaimEpistemicStatus = 'verified' | 'assumed';

export interface WorkroomStructuredReportClaim {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly status: WorkroomClaimEpistemicStatus;
  readonly evidenceRefs: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly validUntil?: number;
  readonly supersedesFactIds?: readonly string[];
}

export interface WorkroomStructuredTaskReport {
  readonly ref: string;
  readonly candidateHash: string;
  readonly projectId: string;
  readonly runId: string;
  readonly planRef: string;
  readonly planRevision: number;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly claims: readonly WorkroomStructuredReportClaim[];
}

export interface WorkroomProjectMemoryClaimRule {
  readonly key: string;
  readonly valueType: 'string';
  readonly allowedStatuses: readonly WorkroomClaimEpistemicStatus[];
  readonly allowSupersedes: boolean;
}

export interface WorkroomProjectMemorySchemaSnapshot {
  readonly revision: number;
  readonly digest: string;
  readonly claimRules: readonly WorkroomProjectMemoryClaimRule[];
}

export function createWorkroomProjectMemorySchemaSnapshot(
  input: Omit<WorkroomProjectMemorySchemaSnapshot, 'digest'>,
): WorkroomProjectMemorySchemaSnapshot {
  return normalizeSchema(input.revision, input.claimRules);
}

export interface WorkroomAcceptedTaskMemory {
  readonly id: string;
  readonly projectId: string;
  readonly runId: string;
  readonly planRef: string;
  readonly planRevision: number;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly summary: string;
  readonly claimIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly sourceReportRef: string;
  readonly sourceAcceptanceId: string;
  readonly schemaRevision: number;
  readonly sourceHash: string;
}

export interface WorkroomAcceptedProjectStatePatch {
  readonly id: string;
  readonly projectId: string;
  readonly runId: string;
  readonly planRef: string;
  readonly planRevision: number;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly baseStateRevision: number;
  readonly sourceSequence: number;
  readonly acceptanceId: string;
  readonly reportRef: string;
  readonly candidateHash: string;
  readonly schemaRevision: number;
  readonly schemaDigest: string;
  readonly claims: readonly WorkroomAcceptedProjectStateClaim[];
}

export interface WorkroomAcceptedProjectStateClaim extends WorkroomStructuredReportClaim {
  readonly factId: string;
  readonly sourceAcceptanceId: string;
  readonly sourceReportRef: string;
}

export interface WorkroomAcceptedSourceProjection {
  readonly memory: WorkroomAcceptedTaskMemory;
  readonly statePatch: WorkroomAcceptedProjectStatePatch;
  readonly sourceHash: string;
}

export function projectAcceptedTaskMemory(input: Readonly<{
  projectId: string;
  runId: string;
  report: WorkroomStructuredTaskReport;
  acceptance: WorkroomAcceptanceRecord;
  schema: WorkroomProjectMemorySchemaSnapshot;
  baseStateRevision: number;
  previousSourceSequence: number;
}>): WorkroomAcceptedSourceProjection {
  const projectId = requireString(input.projectId, 'Project id');
  const runId = requireString(input.runId, 'Run id');
  const report = validateReport(input.report);
  const acceptance = input.acceptance;
  const schema = validateSchema(input.schema);
  const baseStateRevision = nonNegativeInteger(input.baseStateRevision, 'base state revision');
  const previousSourceSequence = sequence(input.previousSourceSequence, 'previous source sequence');

  if (acceptance.disposition !== 'accepted') {
    throw new Error('Project Memory requires an accepted Acceptance Record');
  }
  assertPersistedAcceptanceRecord(
    acceptance,
    report.taskKey,
    report.ref,
    acceptance.acceptanceSequence,
  );
  if (report.projectId !== projectId) throw new Error('Report Project binding does not match');
  if (report.runId !== runId) throw new Error('Report Run binding does not match');
  if (acceptance.acceptanceSequence <= previousSourceSequence) {
    throw new Error('Acceptance source sequence is stale for the Project State base');
  }
  if (report.candidateHash !== acceptance.candidateHash
    || acceptance.candidate.hash !== acceptance.candidateHash) {
    throw new Error('Candidate hash does not match the Acceptance Record');
  }
  if (report.ref !== acceptance.candidate.reportRef
    || report.taskKey !== acceptance.candidate.taskKey
    || report.taskKey !== acceptance.contract.taskKey
    || report.taskRevision !== acceptance.candidate.taskRevision
    || report.taskRevision !== acceptance.contract.taskRevision
    || acceptance.contractId !== acceptance.contract.id
    || acceptance.policy.id !== acceptance.contract.policy.id
    || acceptance.policy.revision !== acceptance.contract.policy.revision
    || acceptance.policy.digest !== acceptance.contract.policy.digest) {
    throw new Error('Acceptance Record source binding does not match the report');
  }

  const claimsById = new Map(report.claims.map((claim) => [claim.id, claim]));
  assertExactSet(claimsById.keys(), acceptance.candidate.claimIds, 'Candidate claim ids');
  assertPartition(
    acceptance.candidate.claimIds,
    acceptance.acceptedClaimIds,
    acceptance.rejectedClaimIds,
  );

  const rules = new Map(schema.claimRules.map((rule) => [rule.key, rule]));
  const acceptedClaims = [...acceptance.acceptedClaimIds]
    .sort()
    .map((claimId) => {
      const claim = claimsById.get(claimId);
      if (!claim) throw new Error(`Accepted claim ${claimId} is absent from the report`);
      const rule = rules.get(claim.key);
      if (!rule) {
        throw new Error(`Accepted claim ${claimId} is outside Project Memory schema`);
      }
      if (!rule.allowedStatuses.includes(claim.status)) {
        throw new Error(`Accepted claim ${claimId} status violates Project Memory schema`);
      }
      if (!rule.allowSupersedes && (claim.supersedesFactIds?.length ?? 0) > 0) {
        throw new Error(`Accepted claim ${claimId} supersedes facts outside Project Memory schema`);
      }
      if (claim.status === 'verified' && claim.evidenceRefs.length === 0) {
        throw new Error(`Verified claim ${claimId} requires evidence`);
      }
      return freezeClaim(claim);
    });

  const source = deepFreeze({
    projectId,
    runId,
    reportRef: report.ref,
    planRef: report.planRef,
    planRevision: report.planRevision,
    taskKey: report.taskKey,
    taskRevision: report.taskRevision,
    candidateHash: report.candidateHash,
    acceptanceId: acceptance.id,
    acceptanceSequence: acceptance.acceptanceSequence,
    contractId: acceptance.contractId,
    contractDigest: acceptance.contract.digest,
    policyId: acceptance.policy.id,
    policyRevision: acceptance.policy.revision,
    policyDigest: acceptance.policy.digest,
    schemaRevision: schema.revision,
    schemaDigest: schema.digest,
    baseStateRevision,
    previousSourceSequence,
    acceptedClaims,
  });
  const sourceHash = digest(source);
  const claimIds = Object.freeze(acceptedClaims.map(({ id }) => id));
  const evidenceRefs = uniqueSorted(acceptedClaims.flatMap(({ evidenceRefs: refs }) => refs));
  const artifactRefs = uniqueSorted(acceptedClaims.flatMap(({ artifactRefs: refs }) => refs));
  const summary = acceptedClaims.length === 0
    ? `Accepted ${report.taskKey}@${report.taskRevision}: no Project State claims.`
    : `Accepted ${report.taskKey}@${report.taskRevision}: ${acceptedClaims
      .map((claim) => `${claim.key}=${claim.value} (${claim.status})`).join('; ')}.`;
  const memory = deepFreeze({
    id: `task-memory:${acceptance.id}:${sourceHash}`,
    projectId,
    runId,
    planRef: report.planRef,
    planRevision: report.planRevision,
    taskKey: report.taskKey,
    taskRevision: report.taskRevision,
    summary,
    claimIds,
    evidenceRefs,
    artifactRefs,
    sourceReportRef: report.ref,
    sourceAcceptanceId: acceptance.id,
    schemaRevision: schema.revision,
    sourceHash,
  });
  const stateClaims = Object.freeze(acceptedClaims.map((claim) => deepFreeze({
    ...claim,
    factId: `project-fact:${acceptance.id}:${encodeURIComponent(claim.id)}`,
    sourceAcceptanceId: acceptance.id,
    sourceReportRef: report.ref,
  })));
  const statePatch = deepFreeze({
    id: `state-patch:${acceptance.id}:${sourceHash}`,
    projectId,
    runId,
    planRef: report.planRef,
    planRevision: report.planRevision,
    taskKey: report.taskKey,
    taskRevision: report.taskRevision,
    baseStateRevision,
    sourceSequence: acceptance.acceptanceSequence,
    acceptanceId: acceptance.id,
    reportRef: report.ref,
    candidateHash: report.candidateHash,
    schemaRevision: schema.revision,
    schemaDigest: schema.digest,
    claims: stateClaims,
  });
  return deepFreeze({ memory, statePatch, sourceHash });
}

function validateReport(report: WorkroomStructuredTaskReport): WorkroomStructuredTaskReport {
  requireString(report.ref, 'Report ref');
  requireString(report.candidateHash, 'Candidate hash');
  requireString(report.projectId, 'Report Project id');
  requireString(report.runId, 'Report Run id');
  requireString(report.planRef, 'Report Plan ref');
  if (!Number.isSafeInteger(report.planRevision) || report.planRevision < 1) {
    throw new Error('Plan revision must be a positive safe integer');
  }
  requireString(report.taskKey, 'Task key');
  if (!Number.isSafeInteger(report.taskRevision) || report.taskRevision < 1) {
    throw new Error('Task revision must be a positive safe integer');
  }
  const ids = new Set<string>();
  for (const claim of report.claims) {
    requireString(claim.id, 'Claim id');
    requireString(claim.key, 'Claim key');
    requireString(claim.value, 'Claim value');
    if (claim.status !== 'verified' && claim.status !== 'assumed') {
      throw new Error(`Claim ${claim.id} has an invalid epistemic status`);
    }
    requireStringArray(claim.evidenceRefs, `Claim ${claim.id} evidence refs`);
    requireStringArray(claim.artifactRefs, `Claim ${claim.id} artifact refs`);
    if (claim.supersedesFactIds !== undefined) {
      requireStringArray(claim.supersedesFactIds, `Claim ${claim.id} supersedes fact ids`);
      if (new Set(claim.supersedesFactIds).size !== claim.supersedesFactIds.length) {
        throw new Error(`Claim ${claim.id} has duplicate supersedes fact ids`);
      }
    }
    if (claim.validUntil !== undefined
      && (!Number.isSafeInteger(claim.validUntil) || claim.validUntil < 0)) {
      throw new Error(`Claim ${claim.id} has an invalid validity deadline`);
    }
    if (ids.has(claim.id)) throw new Error(`Duplicate report claim ${claim.id}`);
    ids.add(claim.id);
  }
  return report;
}

function validateSchema(
  schema: WorkroomProjectMemorySchemaSnapshot,
): WorkroomProjectMemorySchemaSnapshot {
  requireString(schema.digest, 'Project Memory schema digest');
  if (!/^sha256:[a-f0-9]{64}$/u.test(schema.digest)) {
    throw new Error('Project Memory schema digest must be SHA-256');
  }
  const canonical = normalizeSchema(schema.revision, schema.claimRules);
  if (schema.digest !== canonical.digest) {
    throw new Error('Project Memory schema digest does not match its rules');
  }
  return canonical;
}

function normalizeSchema(
  revision: number,
  claimRules: readonly WorkroomProjectMemoryClaimRule[],
): WorkroomProjectMemorySchemaSnapshot {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('Project Memory schema revision must be a positive safe integer');
  }
  if (!Array.isArray(claimRules)) throw new Error('Project Memory schema rules must be an array');
  const rules = claimRules.map((rule) => {
    requireString(rule.key, 'Project Memory schema claim key');
    if (rule.valueType !== 'string') throw new Error(`Unsupported Project Memory value type for ${rule.key}`);
    if (!Array.isArray(rule.allowedStatuses) || rule.allowedStatuses.length === 0
      || rule.allowedStatuses.some((status: unknown) => status !== 'verified' && status !== 'assumed')) {
      throw new Error(`Invalid Project Memory statuses for ${rule.key}`);
    }
    if (new Set(rule.allowedStatuses).size !== rule.allowedStatuses.length) {
      throw new Error(`Duplicate Project Memory statuses for ${rule.key}`);
    }
    if (typeof rule.allowSupersedes !== 'boolean') {
      throw new Error(`Invalid Project Memory supersedes policy for ${rule.key}`);
    }
    return deepFreeze({
      key: rule.key,
      valueType: 'string' as const,
      allowedStatuses: Object.freeze([...rule.allowedStatuses].sort()),
      allowSupersedes: rule.allowSupersedes,
    });
  });
  const keys = rules.map(({ key }) => key);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Project Memory schema contains duplicate claim keys');
  }
  rules.sort((left, right) => compareCanonicalWorkroomText(left.key, right.key));
  const projection = deepFreeze({ revision, claimRules: Object.freeze(rules) });
  return deepFreeze({ ...projection, digest: digest(projection) });
}

function assertPartition(
  candidateIds: readonly string[],
  acceptedIds: readonly string[],
  rejectedIds: readonly string[],
): void {
  requireStringArray(acceptedIds, 'Accepted claim ids');
  requireStringArray(rejectedIds, 'Rejected claim ids');
  if (new Set(acceptedIds).size !== acceptedIds.length
    || new Set(rejectedIds).size !== rejectedIds.length) {
    throw new Error('Acceptance claim partition contains duplicates');
  }
  const overlap = acceptedIds.find((id) => rejectedIds.includes(id));
  if (overlap) throw new Error(`Acceptance claim partition overlaps at ${overlap}`);
  assertExactSet([...acceptedIds, ...rejectedIds], candidateIds, 'Acceptance claim partition');
}

function assertExactSet(actualValues: Iterable<string>, expectedValues: readonly string[], name: string): void {
  requireStringArray(expectedValues, name);
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
  if (new Set(expected).size !== expected.length
    || actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${name} do not form an exact set`);
  }
}

function freezeClaim(claim: WorkroomStructuredReportClaim): WorkroomStructuredReportClaim {
  return deepFreeze({
    id: claim.id,
    key: claim.key,
    value: claim.value,
    status: claim.status,
    evidenceRefs: uniqueSorted(claim.evidenceRefs),
    artifactRefs: uniqueSorted(claim.artifactRefs),
    supersedesFactIds: uniqueSorted(claim.supersedesFactIds ?? []),
    ...(claim.validUntil === undefined ? {} : { validUntil: claim.validUntil }),
  });
}

function requireString(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new Error(`${name} must be a non-empty canonical string`);
  }
  return value;
}

function requireStringArray(values: readonly string[], name: string): void {
  if (!Array.isArray(values)) throw new Error(`${name} must be an array`);
  for (const value of values) requireString(value, name);
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}

function sequence(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < -1) throw new Error(`Invalid ${name}`);
  return value;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}
