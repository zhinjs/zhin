import type {
  WorkroomBlocker,
  WorkroomBlockerKind,
  WorkroomEvent,
  WorkroomEventDraft,
} from '../kernel-contracts.js';
import type { WorkroomGovernedPayloadReceipt } from '../workroom-task-report-store.js';
import type {
  GovernedPayloadPublicationVerification,
  GovernedPayloadWriteSagaSnapshot,
} from '../../data-governance/governed-payload-write-saga.js';

export interface WorkroomJournalPayloadWriteInput {
  readonly projectId: string;
  readonly runId: string;
  readonly eventId: string;
  readonly eventType: WorkroomEvent['type'];
  readonly occurredAt: number;
  readonly fieldPath: string;
  readonly value: unknown;
  readonly contentHash: string;
  readonly source: Readonly<{
    ref: string;
    digest: string;
    bindingDigest: string;
  }>;
}

export interface WorkroomJournalPayloadReadInput {
  readonly projectId: string;
  readonly runId: string;
  readonly eventId: string;
  readonly eventType: WorkroomEvent['type'];
  readonly fieldPath: string;
  readonly contentHash: string;
  readonly receipt: WorkroomGovernedPayloadReceipt;
  readonly purpose: 'kernel-replay';
}

/**
 * Narrow P12 boundary for governed Workroom Journal text. Implementations own
 * storage, current-policy authorization and source-lineage verification.
 */
export interface WorkroomJournalPayloadPort {
  write(input: WorkroomJournalPayloadWriteInput): Promise<WorkroomGovernedPayloadReceipt>;
  read(input: WorkroomJournalPayloadReadInput): Promise<unknown>;
  publish?(input: Readonly<{
    projectId: string;
    runId: string;
    receipts: readonly WorkroomGovernedPayloadReceipt[];
    publicationDigest: string;
  }>): Promise<void>;
  prepare?(input: Readonly<{
    projectId: string;
    runId: string;
    receipts: readonly WorkroomGovernedPayloadReceipt[];
  }>): Promise<void>;
  abandon?(input: Readonly<{
    projectId: string;
    runId: string;
    receipts: readonly WorkroomGovernedPayloadReceipt[];
    reason: 'cas_lost' | 'write_failed';
  }>): Promise<void>;
  reconcile?(input: Readonly<{
    projectId: string;
    runId: string;
    receipts: readonly WorkroomGovernedPayloadReceipt[];
    publicationDigest: string;
  }>): Promise<void>;
}

export class WorkroomJournalPayloadAuthorityUnavailableError extends Error {
  constructor() {
    super('Governed Workroom Journal payload authority is unavailable');
    this.name = 'WorkroomJournalPayloadAuthorityUnavailableError';
  }
}

export interface GovernedWorkroomJournalPayloadReference {
  readonly version: 1;
  readonly kind: 'governed_workroom_journal_payload';
  readonly fieldPath: string;
  readonly contentHash: string;
  readonly receipt: WorkroomGovernedPayloadReceipt;
}

export interface StoredWorkroomEvent extends Omit<WorkroomEvent, 'version' | 'payload'> {
  readonly version: 3;
  /** Content-free control projection derived before payload protection. */
  readonly control: WorkroomStoredEventControl;
  readonly payload: Readonly<Record<string, unknown>>;
}

export class WorkroomSequenceConflictError extends Error {
  constructor(
    readonly runId: string,
    readonly expectedSequence: number,
    readonly actualSequence: number,
  ) {
    super(`Workroom ${runId} sequence conflict: expected ${expectedSequence}, actual ${actualSequence}`);
    this.name = 'WorkroomSequenceConflictError';
  }
}

export interface WorkroomJournal {
  listRunIds(): Promise<readonly string[]>;
  /** Content-free stored envelopes only; implementations must never materialize governed payloads. */
  scanStoredHeaders(): Promise<readonly WorkroomStoredRunHeaders[]>;
  /** Content-free stored envelopes only; implementations must never materialize governed payloads. */
  readStoredHeaders(runId: string): Promise<WorkroomStoredRunHeaders | null>;
  /** Content-free generation handoff verification; optional adapters remain fail-closed/pending. */
  verifyGovernedPayloadPublication?(
    intent: GovernedPayloadWriteSagaSnapshot,
  ): Promise<GovernedPayloadPublicationVerification>;
  read(runId: string): Promise<readonly WorkroomEvent[]>;
  append(
    runId: string,
    expectedSequence: number,
    events: readonly WorkroomEventDraft[],
  ): Promise<readonly WorkroomEvent[]>;
}

export interface WorkroomStoredEventHeader {
  readonly version: 1;
  readonly eventRef: string;
  readonly runId: string;
  readonly sequence: number;
  readonly occurredAt: number;
  readonly type: WorkroomEvent['type'];
  /** Minimal opaque state-transition fields; raw identifiers and caller text are excluded. */
  readonly control: WorkroomStoredEventControl;
  readonly protectedPayloadDigest: string;
  readonly protectedReceipts: readonly WorkroomStoredProtectedReceiptHeader[];
  readonly digest: string;
}

export interface WorkroomStoredEventControl {
  readonly projectId?: string;
  readonly taskKey?: string;
  readonly assignmentId?: string;
  readonly blockerId?: string;
  readonly blockerKind?: WorkroomBlockerKind;
  readonly blockerDeadline?: number;
  readonly blockerAllowedActions?: WorkroomBlocker['allowedActions'];
  readonly waitId?: string;
  readonly waitStatus?: string;
  readonly role?: WorkroomAssignmentRoleHeader;
  readonly required?: boolean;
  readonly maxAttempts?: number;
  readonly attempt?: number;
  readonly assignmentRevision?: number;
  readonly fence?: number;
  readonly outcome?: 'interrupted' | 'committed' | 'outcome_unknown';
  readonly verdictOutcome?: 'passed' | 'rework';
  readonly decision?: 'approve' | 'reject' | 'request_changes' | 'cancel';
  readonly newTaskRevision?: number;
}

export type WorkroomAssignmentRoleHeader = 'executor' | 'reviewer' | 'integration';

export interface WorkroomStoredProtectedReceiptHeader {
  readonly fieldPath: string;
  readonly contentHash: string;
  readonly descriptorDigest: string;
  readonly sourceDigest: string;
  readonly sourceBindingDigest: string;
}

export interface WorkroomStoredRunHeaders {
  readonly version: 1;
  readonly runId: string;
  readonly events: readonly WorkroomStoredEventHeader[];
  readonly digest: string;
}
