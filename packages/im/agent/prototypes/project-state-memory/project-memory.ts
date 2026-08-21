/**
 * PROTOTYPE — delete after decision-map ticket #4 is absorbed.
 *
 * Question: can accepted Task Reports project Task Memory and Project State,
 * release hot execution context, preserve conflicts/provenance and rebuild from
 * accepted sources without ever summarizing a previous summary?
 */

export type EpistemicStatus = 'verified' | 'assumed';
export type ProjectFactStatus = EpistemicStatus | 'disputed' | 'stale';

export interface ReportClaim {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly proposedStatus: EpistemicStatus;
  readonly evidenceRefs: readonly string[];
  readonly validUntil?: number;
  readonly supersedesFactIds?: readonly string[];
}

export interface TaskReport {
  readonly id: string;
  readonly runId: string;
  readonly planRevision: number;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly summary: string;
  readonly claims: readonly ReportClaim[];
  readonly decisions: readonly string[];
  readonly unresolved: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly sourceFactIds: readonly string[];
}

export interface AcceptanceRecord {
  readonly id: string;
  readonly reportId: string;
  readonly acceptedClaimIds: readonly string[];
  readonly rejectedClaimIds: readonly string[];
  readonly acceptedBy: string;
  readonly sourceEventId: string;
  readonly sequence: number;
}

export interface ProjectFact {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly originalStatus: EpistemicStatus;
  readonly status: ProjectFactStatus;
  readonly evidenceRefs: readonly string[];
  readonly sourceAcceptanceId: string;
  readonly sourceReportId: string;
  readonly sourceClaimId: string;
  readonly validUntil?: number;
  readonly supersededBy?: string;
}

export interface TaskMemory {
  readonly id: string;
  readonly runId: string;
  readonly planRevision: number;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly summary: string;
  readonly claimKeys: readonly string[];
  readonly decisions: readonly string[];
  readonly unresolved: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly sourceReportId: string;
  readonly sourceAcceptanceId: string;
  readonly sourceFactIds: readonly string[];
  readonly sourceHash: string;
}

export interface CurrentStateEntry {
  readonly key: string;
  readonly status: ProjectFactStatus;
  readonly values: readonly string[];
  readonly sourceFactIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface ProjectStateSnapshot {
  readonly revision: number;
  readonly sourceSequence: number;
  readonly schemaVersion: 1;
  readonly entries: readonly CurrentStateEntry[];
}

export interface ProjectMemoryState {
  readonly sequence: number;
  readonly now: number;
  readonly projectId: string;
  readonly reports: Readonly<Record<string, TaskReport>>;
  readonly reportDisposition: Readonly<Record<string, 'execution_completed' | 'accepted' | 'rejected'>>;
  readonly acceptances: Readonly<Record<string, AcceptanceRecord>>;
  readonly facts: Readonly<Record<string, ProjectFact>>;
  readonly taskMemories: Readonly<Record<string, TaskMemory>>;
  readonly executionContexts: Readonly<Record<string, 'hot' | 'released'>>;
  readonly snapshot: ProjectStateSnapshot;
}

export type ProjectMemoryEvent = Readonly<{
  seq: number;
  type:
    | 'project.created'
    | 'task.report_submitted'
    | 'task.report_rejected'
    | 'task.accepted'
    | 'task.memory_created'
    | 'project.state_patch_applied'
    | 'task.execution_context_released'
    | 'project.conflict_resolution_accepted'
    | 'project.conflict_resolved'
    | 'clock.advanced'
    | 'project.validity_evaluated';
  payload: Readonly<Record<string, unknown>>;
}>;

export type ProjectMemoryCommand =
  | Readonly<{ type: 'submit_report'; report: TaskReport }>
  | Readonly<{ type: 'reject_report'; reportId: string; reason: string }>
  | Readonly<{ type: 'accept_report'; reportId: string; acceptedClaimIds: readonly string[]; acceptedBy: string }>
  | Readonly<{ type: 'resolve_conflict'; key: string; winnerFactId: string; acceptedBy: string }>
  | Readonly<{ type: 'advance_clock'; seconds: number }>;

export interface RecallResult {
  readonly query: string;
  readonly currentState: readonly CurrentStateEntry[];
  readonly taskMemories: readonly TaskMemory[];
  readonly evidenceRefs: readonly string[];
}

const PROJECT_SCHEMA_KEYS = new Set([
  'runtime.node.support',
  'release.mode',
  'auth.legacy_claims',
  'migration.deadline',
]);

const SOURCE_EVENT_TYPES = new Set<ProjectMemoryEvent['type']>([
  'project.created',
  'task.report_submitted',
  'task.report_rejected',
  'task.accepted',
  'project.conflict_resolution_accepted',
  'clock.advanced',
]);

export function initialProjectMemoryJournal(projectId = 'project-zhin'): readonly ProjectMemoryEvent[] {
  return [event(0, 'project.created', { projectId })];
}

export function replayProjectMemory(events: readonly ProjectMemoryEvent[]): ProjectMemoryState {
  if (events.length === 0 || events[0]?.type !== 'project.created') {
    throw new Error('journal must begin with project.created');
  }
  let state: ProjectMemoryState = {
    sequence: 0,
    now: 0,
    projectId: String(events[0].payload.projectId),
    reports: {},
    reportDisposition: {},
    acceptances: {},
    facts: {},
    taskMemories: {},
    executionContexts: {},
    snapshot: { revision: 0, sourceSequence: 0, schemaVersion: 1, entries: [] },
  };
  for (const entry of events) state = evolveProjectMemory(state, entry);
  return state;
}

export function dispatchProjectMemory(
  journal: readonly ProjectMemoryEvent[],
  command: ProjectMemoryCommand,
): readonly ProjectMemoryEvent[] {
  const state = replayProjectMemory(journal);
  const decided = decideProjectMemory(state, command);
  return Object.freeze([
    ...journal,
    ...decided.map((entry, index) => ({ ...entry, seq: journal.length + index })),
  ]);
}

export function rebuildFromAcceptedSources(
  journal: readonly ProjectMemoryEvent[],
): readonly ProjectMemoryEvent[] {
  let rebuilt: readonly ProjectMemoryEvent[] = [];
  for (const source of journal.filter((entry) => SOURCE_EVENT_TYPES.has(entry.type))) {
    if (source.type === 'project.created') {
      rebuilt = [event(0, source.type, { ...source.payload })];
      continue;
    }
    const copied = event(rebuilt.length, source.type, { ...source.payload });
    rebuilt = Object.freeze([...rebuilt, copied]);
    const state = replayProjectMemory(rebuilt);
    const derived = deriveAfterSource(state, copied);
    rebuilt = Object.freeze([
      ...rebuilt,
      ...derived.map((entry, index) => ({ ...entry, seq: rebuilt.length + index })),
    ]);
  }
  return rebuilt;
}

export function recallProjectMemory(
  state: ProjectMemoryState,
  query: string,
  includeStale = false,
): RecallResult {
  const normalized = query.trim().toLowerCase();
  const currentState = state.snapshot.entries.filter((entry) => {
    if (!includeStale && entry.status === 'stale') return false;
    const haystack = `${entry.key} ${entry.values.join(' ')}`.toLowerCase();
    return normalized.length === 0 || haystack.includes(normalized);
  });
  const taskMemories = Object.values(state.taskMemories).filter((memory) => {
    const haystack = [
      memory.taskKey,
      memory.summary,
      ...memory.claimKeys,
      ...memory.decisions,
      ...memory.unresolved,
    ].join(' ').toLowerCase();
    return normalized.length === 0 || haystack.includes(normalized);
  });
  const evidenceRefs = [...new Set([
    ...currentState.flatMap((entry) => entry.evidenceRefs),
    ...taskMemories.flatMap((memory) => memory.evidenceRefs),
  ])];
  return Object.freeze({ query, currentState, taskMemories, evidenceRefs });
}

export function comparableProjection(state: ProjectMemoryState): unknown {
  return {
    now: state.now,
    reports: state.reports,
    reportDisposition: state.reportDisposition,
    acceptances: state.acceptances,
    facts: state.facts,
    taskMemories: state.taskMemories,
    executionContexts: state.executionContexts,
    snapshot: state.snapshot,
  };
}

function decideProjectMemory(
  state: ProjectMemoryState,
  command: ProjectMemoryCommand,
): readonly Omit<ProjectMemoryEvent, 'seq'>[] {
  switch (command.type) {
    case 'submit_report': {
      if (state.reports[command.report.id]) throw new Error(`report already exists: ${command.report.id}`);
      validateReportShape(command.report);
      return [domainEvent('task.report_submitted', { report: command.report })];
    }
    case 'reject_report': {
      const report = requireReport(state, command.reportId);
      if (state.reportDisposition[report.id] !== 'execution_completed') {
        throw new Error(`report ${report.id} is already ${state.reportDisposition[report.id]}`);
      }
      return [domainEvent('task.report_rejected', { reportId: report.id, reason: command.reason })];
    }
    case 'accept_report': {
      const report = requireReport(state, command.reportId);
      if (state.reportDisposition[report.id] !== 'execution_completed') {
        throw new Error(`report ${report.id} is already ${state.reportDisposition[report.id]}`);
      }
      const acceptedClaimIds = [...new Set(command.acceptedClaimIds)];
      for (const claimId of acceptedClaimIds) {
        const claim = report.claims.find((candidate) => candidate.id === claimId);
        if (!claim) throw new Error(`acceptance references unknown claim: ${claimId}`);
        validateAcceptedClaim(state, claim);
      }
      const acceptanceId = `accept:${report.id}`;
      const rejectedClaimIds = report.claims
        .filter((claim) => !acceptedClaimIds.includes(claim.id))
        .map((claim) => claim.id);
      const accepted = domainEvent('task.accepted', {
        acceptanceId,
        reportId: report.id,
        acceptedClaimIds,
        rejectedClaimIds,
        acceptedBy: command.acceptedBy,
        sourceEventId: `event://${acceptanceId}`,
      });
      const projectedState = evolvePrototypeEvent(state, accepted);
      return [accepted, ...deriveAcceptedTask(projectedState, acceptanceId)];
    }
    case 'resolve_conflict': {
      const winner = state.facts[command.winnerFactId];
      if (!winner || winner.key !== command.key || winner.status !== 'disputed') {
        throw new Error('winner must be a disputed fact for the requested key');
      }
      const resolutionId = `resolution:${command.key}:${state.sequence + 1}`;
      const accepted = domainEvent('project.conflict_resolution_accepted', {
        resolutionId,
        key: command.key,
        winnerFactId: winner.id,
        acceptedBy: command.acceptedBy,
        sourceEventId: `event://${resolutionId}`,
      });
      return [accepted, domainEvent('project.conflict_resolved', {
        resolutionId,
        key: command.key,
        winnerFactId: winner.id,
      })];
    }
    case 'advance_clock': {
      if (!Number.isFinite(command.seconds) || command.seconds <= 0) throw new Error('seconds must be positive');
      const now = state.now + command.seconds;
      const clock = domainEvent('clock.advanced', { now });
      const projectedState = evolvePrototypeEvent(state, clock);
      const expiring = Object.values(projectedState.facts)
        .filter((fact) => fact.status !== 'stale' && fact.validUntil != null && fact.validUntil <= now)
        .map((fact) => fact.id);
      return expiring.length > 0
        ? [clock, domainEvent('project.validity_evaluated', { now, staleFactIds: expiring })]
        : [clock];
    }
  }
}

function deriveAfterSource(
  state: ProjectMemoryState,
  source: ProjectMemoryEvent,
): readonly Omit<ProjectMemoryEvent, 'seq'>[] {
  if (source.type === 'task.accepted') {
    return deriveAcceptedTask(state, String(source.payload.acceptanceId));
  }
  if (source.type === 'project.conflict_resolution_accepted') {
    return [domainEvent('project.conflict_resolved', {
      resolutionId: source.payload.resolutionId,
      key: source.payload.key,
      winnerFactId: source.payload.winnerFactId,
    })];
  }
  if (source.type === 'clock.advanced') {
    const now = Number(source.payload.now);
    const staleFactIds = Object.values(state.facts)
      .filter((fact) => fact.status !== 'stale' && fact.validUntil != null && fact.validUntil <= now)
      .map((fact) => fact.id);
    return staleFactIds.length > 0
      ? [domainEvent('project.validity_evaluated', { now, staleFactIds })]
      : [];
  }
  return [];
}

function deriveAcceptedTask(
  state: ProjectMemoryState,
  acceptanceId: string,
): readonly Omit<ProjectMemoryEvent, 'seq'>[] {
  const acceptance = state.acceptances[acceptanceId];
  if (!acceptance) throw new Error(`missing acceptance: ${acceptanceId}`);
  const report = requireReport(state, acceptance.reportId);
  const claims = report.claims.filter((claim) => acceptance.acceptedClaimIds.includes(claim.id));
  const sourceHash = hashSource(report, acceptance);
  const memory: TaskMemory = {
    id: `task-memory:${report.taskKey}:r${report.taskRevision}:${acceptance.id}`,
    runId: report.runId,
    planRevision: report.planRevision,
    taskKey: report.taskKey,
    taskRevision: report.taskRevision,
    // Deliberately derive this from accepted claims. Copying report.summary
    // could smuggle a rejected claim into authoritative task memory.
    summary: claims.length === 0
      ? `Accepted ${report.taskKey}@${report.taskRevision} with no Project State claims.`
      : `Accepted ${report.taskKey}@${report.taskRevision}: ${claims
        .map((claim) => `${claim.key}=${claim.value} (${claim.proposedStatus})`)
        .join('; ')}.`,
    claimKeys: claims.map((claim) => claim.key),
    decisions: [...report.decisions],
    unresolved: [...report.unresolved],
    artifactRefs: [...report.artifactRefs],
    evidenceRefs: [...new Set(claims.flatMap((claim) => claim.evidenceRefs))],
    sourceReportId: report.id,
    sourceAcceptanceId: acceptance.id,
    sourceFactIds: [...report.sourceFactIds],
    sourceHash,
  };
  return [
    domainEvent('task.memory_created', { memory }),
    domainEvent('project.state_patch_applied', {
      acceptanceId,
      reportId: report.id,
      claims,
      baseStateRevision: state.snapshot.revision,
      schemaVersion: 1,
    }),
    domainEvent('task.execution_context_released', {
      taskKey: report.taskKey,
      taskRevision: report.taskRevision,
      afterAcceptanceId: acceptanceId,
      retainedRefs: [memory.id, ...memory.artifactRefs, ...memory.evidenceRefs],
    }),
  ];
}

function evolveProjectMemory(
  state: ProjectMemoryState,
  entry: ProjectMemoryEvent,
): ProjectMemoryState {
  const reports = { ...state.reports };
  const reportDisposition = { ...state.reportDisposition };
  const acceptances = { ...state.acceptances };
  const facts = { ...state.facts };
  const taskMemories = { ...state.taskMemories };
  const executionContexts = { ...state.executionContexts };
  let next: ProjectMemoryState = {
    ...state,
    sequence: entry.seq,
    reports,
    reportDisposition,
    acceptances,
    facts,
    taskMemories,
    executionContexts,
  };
  const payload = entry.payload;
  switch (entry.type) {
    case 'project.created': break;
    case 'task.report_submitted': {
      const report = payload.report as unknown as TaskReport;
      reports[report.id] = report;
      reportDisposition[report.id] = 'execution_completed';
      executionContexts[taskRevisionKey(report.taskKey, report.taskRevision)] = 'hot';
      break;
    }
    case 'task.report_rejected':
      reportDisposition[String(payload.reportId)] = 'rejected';
      break;
    case 'task.accepted': {
      const acceptanceId = String(payload.acceptanceId);
      const record: AcceptanceRecord = {
        id: acceptanceId,
        reportId: String(payload.reportId),
        acceptedClaimIds: payload.acceptedClaimIds as readonly string[],
        rejectedClaimIds: payload.rejectedClaimIds as readonly string[],
        acceptedBy: String(payload.acceptedBy),
        sourceEventId: String(payload.sourceEventId),
        sequence: entry.seq,
      };
      acceptances[record.id] = record;
      reportDisposition[record.reportId] = 'accepted';
      break;
    }
    case 'task.memory_created': {
      const memory = payload.memory as unknown as TaskMemory;
      taskMemories[memory.id] = memory;
      break;
    }
    case 'project.state_patch_applied': {
      const acceptanceId = String(payload.acceptanceId);
      const reportId = String(payload.reportId);
      const claims = payload.claims as unknown as readonly ReportClaim[];
      for (const claim of claims) applyClaim(facts, acceptanceId, reportId, claim);
      next = withFreshSnapshot(next, facts, entry.seq);
      break;
    }
    case 'task.execution_context_released':
      executionContexts[taskRevisionKey(String(payload.taskKey), Number(payload.taskRevision))] = 'released';
      break;
    case 'project.conflict_resolution_accepted': break;
    case 'project.conflict_resolved': {
      const key = String(payload.key);
      const winnerFactId = String(payload.winnerFactId);
      for (const fact of Object.values(facts).filter((candidate) => candidate.key === key && candidate.status !== 'stale')) {
        facts[fact.id] = fact.id === winnerFactId
          ? { ...fact, status: fact.originalStatus }
          : { ...fact, status: 'stale', supersededBy: winnerFactId };
      }
      next = withFreshSnapshot(next, facts, entry.seq);
      break;
    }
    case 'clock.advanced':
      next = { ...next, now: Number(payload.now) };
      break;
    case 'project.validity_evaluated': {
      const staleFactIds = payload.staleFactIds as readonly string[];
      for (const factId of staleFactIds) {
        const fact = facts[factId];
        if (fact) facts[factId] = { ...fact, status: 'stale', supersededBy: `expiry@${payload.now}` };
      }
      next = withFreshSnapshot(next, facts, entry.seq);
      break;
    }
  }
  return next;
}

function applyClaim(
  facts: Record<string, ProjectFact>,
  acceptanceId: string,
  reportId: string,
  claim: ReportClaim,
): void {
  const factId = `${acceptanceId}:${claim.id}`;
  const supersedes = new Set(claim.supersedesFactIds ?? []);
  for (const targetId of supersedes) {
    const target = facts[targetId];
    if (target) facts[targetId] = { ...target, status: 'stale', supersededBy: factId };
  }
  const active = Object.values(facts).filter((fact) => fact.key === claim.key && fact.status !== 'stale');
  const conflicting = active.filter((fact) => fact.value !== claim.value && !supersedes.has(fact.id));
  if (conflicting.length > 0) {
    for (const fact of conflicting) facts[fact.id] = { ...fact, status: 'disputed' };
  }
  facts[factId] = {
    id: factId,
    key: claim.key,
    value: claim.value,
    originalStatus: claim.proposedStatus,
    status: conflicting.length > 0 ? 'disputed' : claim.proposedStatus,
    evidenceRefs: [...claim.evidenceRefs],
    sourceAcceptanceId: acceptanceId,
    sourceReportId: reportId,
    sourceClaimId: claim.id,
    ...(claim.validUntil != null ? { validUntil: claim.validUntil } : {}),
  };
}

function withFreshSnapshot(
  state: ProjectMemoryState,
  facts: Readonly<Record<string, ProjectFact>>,
  sourceSequence: number,
): ProjectMemoryState {
  return {
    ...state,
    facts,
    snapshot: {
      revision: state.snapshot.revision + 1,
      sourceSequence,
      schemaVersion: 1,
      entries: projectCurrentState(Object.values(facts)),
    },
  };
}

function projectCurrentState(facts: readonly ProjectFact[]): CurrentStateEntry[] {
  const keys = [...new Set(facts.map((fact) => fact.key))].sort();
  const entries: CurrentStateEntry[] = [];
  for (const key of keys) {
    const all = facts.filter((fact) => fact.key === key);
    const active = all.filter((fact) => fact.status !== 'stale');
    if (active.length === 0) {
      entries.push({
        key,
        status: 'stale',
        values: [...new Set(all.map((fact) => fact.value))].sort(),
        sourceFactIds: all.map((fact) => fact.id).sort(),
        evidenceRefs: [...new Set(all.flatMap((fact) => fact.evidenceRefs))].sort(),
      });
      continue;
    }
    const values = [...new Set(active.map((fact) => fact.value))].sort();
    const status: ProjectFactStatus = values.length > 1 || active.some((fact) => fact.status === 'disputed')
      ? 'disputed'
      : active.some((fact) => fact.originalStatus === 'verified') ? 'verified' : 'assumed';
    entries.push({
      key,
      status,
      values,
      sourceFactIds: active.map((fact) => fact.id).sort(),
      evidenceRefs: [...new Set(active.flatMap((fact) => fact.evidenceRefs))].sort(),
    });
  }
  return entries;
}

function validateReportShape(report: TaskReport): void {
  if (!report.id || !report.runId || report.planRevision < 1 || !report.taskKey || report.taskRevision < 1) {
    throw new Error('invalid Task Report identity');
  }
  const claimIds = new Set<string>();
  for (const claim of report.claims) {
    if (claimIds.has(claim.id)) throw new Error(`duplicate claim id: ${claim.id}`);
    claimIds.add(claim.id);
  }
}

function validateAcceptedClaim(state: ProjectMemoryState, claim: ReportClaim): void {
  if (!PROJECT_SCHEMA_KEYS.has(claim.key)) throw new Error(`claim key is outside Project Memory Schema: ${claim.key}`);
  if (claim.evidenceRefs.length === 0 && claim.proposedStatus === 'verified') {
    throw new Error(`verified claim requires evidence: ${claim.id}`);
  }
  for (const targetId of claim.supersedesFactIds ?? []) {
    const target = state.facts[targetId];
    if (!target) throw new Error(`supersedes unknown Project fact: ${targetId}`);
    if (target.key !== claim.key) throw new Error(`cannot supersede a different semantic key: ${targetId}`);
  }
}

function requireReport(state: ProjectMemoryState, reportId: string): TaskReport {
  const report = state.reports[reportId];
  if (!report) throw new Error(`unknown report: ${reportId}`);
  return report;
}

function taskRevisionKey(taskKey: string, revision: number): string {
  return `${taskKey}@${revision}`;
}

function hashSource(report: TaskReport, acceptance: AcceptanceRecord): string {
  const text = JSON.stringify({ report, acceptance });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function evolvePrototypeEvent(
  state: ProjectMemoryState,
  entry: Omit<ProjectMemoryEvent, 'seq'>,
): ProjectMemoryState {
  return evolveProjectMemory(state, { ...entry, seq: state.sequence + 1 });
}

function event(
  seq: number,
  type: ProjectMemoryEvent['type'],
  payload: Record<string, unknown>,
): ProjectMemoryEvent {
  return Object.freeze({ seq, type, payload: Object.freeze(payload) });
}

function domainEvent(
  type: ProjectMemoryEvent['type'],
  payload: Record<string, unknown>,
): Omit<ProjectMemoryEvent, 'seq'> {
  return { type, payload: Object.freeze(payload) };
}

export function baselineReport(): TaskReport {
  return Object.freeze({
    id: 'report-baseline',
    runId: 'run-auth-modernization',
    planRevision: 1,
    taskKey: 'auth-research',
    taskRevision: 1,
    summary: 'Verified current Node support and PR-only delivery mode.',
    claims: [
      { id: 'node22', key: 'runtime.node.support', value: '22', proposedStatus: 'verified', evidenceRefs: ['evidence:node22'] },
      { id: 'pr-only', key: 'release.mode', value: 'pr_only', proposedStatus: 'verified', evidenceRefs: ['artifact:charter'] },
    ],
    decisions: ['Use a reviewable PR; no deployment.'],
    unresolved: ['Node 20 compatibility still needs evidence.'],
    artifactRefs: ['artifact:compat-matrix'],
    sourceFactIds: ['report-fact:baseline', 'acceptance-tests:baseline'],
  } satisfies TaskReport);
}

export function conflictingReport(): TaskReport {
  return Object.freeze({
    id: 'report-conflict',
    runId: 'run-auth-modernization',
    planRevision: 1,
    taskKey: 'auth-compat',
    taskRevision: 1,
    summary: 'A separate accepted check claims Node 20 is the supported baseline.',
    claims: [
      { id: 'node20', key: 'runtime.node.support', value: '20', proposedStatus: 'verified', evidenceRefs: ['evidence:node20'] },
    ],
    decisions: [],
    unresolved: ['Conflicts with the Node 22 baseline report.'],
    artifactRefs: ['artifact:node20-log'],
    sourceFactIds: ['report-fact:conflict'],
  } satisfies TaskReport);
}

export function correctiveReport(currentFactIds: readonly string[]): TaskReport {
  return Object.freeze({
    id: 'report-corrective',
    runId: 'run-auth-modernization',
    planRevision: 2,
    taskKey: 'auth-compat',
    taskRevision: 2,
    summary: 'Rework verifies that both Node 20 and Node 22 are supported.',
    claims: [
      {
        id: 'node20-22',
        key: 'runtime.node.support',
        value: '20,22',
        proposedStatus: 'verified',
        evidenceRefs: ['evidence:matrix-v2'],
        supersedesFactIds: currentFactIds,
      },
    ],
    decisions: ['Support both Node 20 and Node 22.'],
    unresolved: [],
    artifactRefs: ['artifact:matrix-v2'],
    sourceFactIds: ['report-fact:corrective', 'test-log:node20', 'test-log:node22'],
  } satisfies TaskReport);
}

export function expiringAssumptionReport(now: number): TaskReport {
  return Object.freeze({
    id: 'report-assumption',
    runId: 'run-auth-modernization',
    planRevision: 2,
    taskKey: 'migration-plan',
    taskRevision: 1,
    summary: 'Records a temporary migration deadline assumption.',
    claims: [
      { id: 'deadline', key: 'migration.deadline', value: 'T+30', proposedStatus: 'assumed', evidenceRefs: [], validUntil: now + 30 },
    ],
    decisions: [],
    unresolved: ['Sponsor must confirm the actual date.'],
    artifactRefs: [],
    sourceFactIds: ['report-fact:assumption'],
  } satisfies TaskReport);
}

export function unsafeUnacceptedReport(): TaskReport {
  return Object.freeze({
    id: 'report-unaccepted',
    runId: 'run-auth-modernization',
    planRevision: 1,
    taskKey: 'deploy-attempt',
    taskRevision: 1,
    summary: 'Executor claims production was deployed, but no acceptance exists.',
    claims: [
      { id: 'deployed', key: 'release.mode', value: 'deployed', proposedStatus: 'verified', evidenceRefs: ['untrusted:executor-claim'] },
    ],
    decisions: [],
    unresolved: ['Claim is not accepted.'],
    artifactRefs: [],
    sourceFactIds: ['report-fact:unaccepted'],
  } satisfies TaskReport);
}
