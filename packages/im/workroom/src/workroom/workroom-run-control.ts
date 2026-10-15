import type { WorkroomRunState, WorkroomRunStatus } from './kernel-contracts.js';
import { digestCanonicalWorkroomValue } from './canonical-value.js';
import type { WorkroomCatalog } from './catalog.js';

export type WorkroomRunCancelReasonCode =
  | 'operator_request'
  | 'no_longer_required'
  | 'superseded'
  | 'policy_change';

export type WorkroomRunReplanReasonCode =
  | 'requirements_changed'
  | 'blocker_recovery'
  | 'policy_change'
  | 'operator_request';

export type WorkroomRunControlCommand =
  | Readonly<{
      version: 1;
      operationId: string;
      projectId: string;
      runId: string;
      expectedSequence: number;
      action: 'cancel';
      reasonCode: WorkroomRunCancelReasonCode;
      controlDeadline: number;
    }>
  | Readonly<{
      version: 1;
      operationId: string;
      projectId: string;
      runId: string;
      expectedSequence: number;
      action: 'request_replan';
      reasonCode: WorkroomRunReplanReasonCode;
    }>;

export interface WorkroomRunControlAuthorizationInput {
  readonly version: 1;
  readonly purpose: 'commit' | 'stale_probe';
  readonly command: WorkroomRunControlCommand;
  readonly authenticatedPrincipalId: string;
  readonly requestDigest: string;
  readonly stateSequence: number;
  readonly stateStatus: WorkroomRunStatus;
  readonly stateDigest: string;
}

export type WorkroomRunControlAuthorizationDecision =
  | Readonly<{
      authorized: true;
      principalId: string;
      catalogRevision: string;
      projectDigest: string;
      authorizationRef: string;
    }>
  | Readonly<{ authorized: false; reason: string }>;

export interface WorkroomRunControlAuthorityPort {
  authorize(
    input: WorkroomRunControlAuthorizationInput,
  ): WorkroomRunControlAuthorizationDecision | Promise<WorkroomRunControlAuthorizationDecision>;
}

export type WorkroomRunControlReceipt =
  | Readonly<{
      status: 'committed' | 'duplicate';
      action: WorkroomRunControlCommand['action'];
      operationId: string;
      receiptRef: string;
      receiptDigest: string;
      state: WorkroomRunState;
    }>
  | Readonly<{ status: 'stale'; actualSequence: number }>;

export class WorkroomRunControlUnauthorizedError extends Error {
  constructor(readonly reason: string) {
    super(`Workroom Run control is unauthorized: ${reason}`);
    this.name = 'WorkroomRunControlUnauthorizedError';
  }
}

export function assertWorkroomRunControlCommand(
  command: WorkroomRunControlCommand,
): void {
  if (!command || command.version !== 1) throw new Error('Workroom Run control version is invalid');
  requireText(command.operationId, 'Workroom Run control operationId');
  requireText(command.projectId, 'Workroom Run control projectId');
  requireText(command.runId, 'Workroom Run control runId');
  if (!Number.isSafeInteger(command.expectedSequence) || command.expectedSequence < 0) {
    throw new Error('Workroom Run control expectedSequence is invalid');
  }
  if (command.action === 'cancel') {
    if (!isWorkroomRunCancelReasonCode(command.reasonCode)) {
      throw new Error('Workroom Run cancellation reasonCode is invalid');
    }
    if (!Number.isSafeInteger(command.controlDeadline) || command.controlDeadline < 0) {
      throw new Error('Workroom Run cancellation controlDeadline is invalid');
    }
    assertExactKeys(command, [
      'version', 'operationId', 'projectId', 'runId', 'expectedSequence',
      'action', 'reasonCode', 'controlDeadline',
    ]);
    return;
  }
  if (command.action !== 'request_replan' || !isWorkroomRunReplanReasonCode(command.reasonCode)) {
    throw new Error('Workroom Run replan reasonCode is invalid');
  }
  assertExactKeys(command, [
    'version', 'operationId', 'projectId', 'runId', 'expectedSequence', 'action', 'reasonCode',
  ]);
}

/** Closed transport parser shared by Host and other trusted composition roots. */
export function parseWorkroomRunControlCommand(value: unknown): WorkroomRunControlCommand {
  if (!isRecord(value)) throw new Error('Workroom Run control body is invalid');
  const text = (key: string): string => {
    const candidate = value[key];
    if (typeof candidate !== 'string') throw new Error(`Workroom Run control ${key} is invalid`);
    requireText(candidate, `Workroom Run control ${key}`);
    return candidate.trim();
  };
  if (value.version !== 1 || !Number.isSafeInteger(value.expectedSequence)
    || Number(value.expectedSequence) < 0) {
    throw new Error('Workroom Run control version or expectedSequence is invalid');
  }
  const common = {
    version: 1 as const,
    operationId: text('operationId'),
    projectId: text('projectId'),
    runId: text('runId'),
    expectedSequence: Number(value.expectedSequence),
  };
  if (value.action === 'cancel') {
    if (!isWorkroomRunCancelReasonCode(value.reasonCode)
      || !Number.isSafeInteger(value.controlDeadline) || Number(value.controlDeadline) < 0) {
      throw new Error('Workroom Run cancellation scope is invalid');
    }
    assertExactKeys(value, [
      'version', 'operationId', 'projectId', 'runId', 'expectedSequence',
      'action', 'reasonCode', 'controlDeadline',
    ]);
    return Object.freeze({
      ...common,
      action: 'cancel',
      reasonCode: value.reasonCode,
      controlDeadline: Number(value.controlDeadline),
    });
  }
  if (value.action !== 'request_replan' || !isWorkroomRunReplanReasonCode(value.reasonCode)) {
    throw new Error('Workroom Run replan scope is invalid');
  }
  assertExactKeys(value, [
    'version', 'operationId', 'projectId', 'runId', 'expectedSequence', 'action', 'reasonCode',
  ]);
  return Object.freeze({ ...common, action: 'request_replan', reasonCode: value.reasonCode });
}

export function workroomRunControlRequestDigest(
  command: WorkroomRunControlCommand,
  authenticatedPrincipalId: string,
): string {
  assertWorkroomRunControlCommand(command);
  requireText(authenticatedPrincipalId, 'Workroom Run control authenticated principal');
  return digestCanonicalWorkroomValue({ version: 1, command, authenticatedPrincipalId });
}

/** Current persistent Catalog Sponsor membership is the only standard mutation authority. */
export function createCatalogWorkroomRunControlAuthority(
  catalog: Pick<WorkroomCatalog, 'read'>,
): WorkroomRunControlAuthorityPort {
  return Object.freeze({
    async authorize(
      input: WorkroomRunControlAuthorizationInput,
    ): Promise<WorkroomRunControlAuthorizationDecision> {
      const snapshot = await catalog.read();
      if (input.purpose !== 'commit' && input.purpose !== 'stale_probe'
        || (input.purpose === 'commit') !== (input.command.expectedSequence === input.stateSequence)
        || input.requestDigest !== workroomRunControlRequestDigest(
          input.command,
          input.authenticatedPrincipalId,
        )
        || !/^sha256:[a-f0-9]{64}$/u.test(input.stateDigest)) {
        return Object.freeze({ authorized: false, reason: 'control_scope_not_exact' });
      }
      const definition = snapshot.definitions[input.command.projectId];
      if (!definition || definition.enabled === false) {
        return Object.freeze({ authorized: false, reason: 'project_not_active' });
      }
      if (!definition.sponsors?.includes(input.authenticatedPrincipalId)) {
        return Object.freeze({ authorized: false, reason: 'principal_is_not_project_sponsor' });
      }
      const projectDigest = digestCanonicalWorkroomValue(definition);
      return Object.freeze({
        authorized: true,
        principalId: input.authenticatedPrincipalId,
        catalogRevision: snapshot.revision,
        projectDigest,
        authorizationRef: [
          'workroom-run-control:v1', snapshot.revision, input.command.projectId,
          projectDigest, input.authenticatedPrincipalId, input.command.action, input.requestDigest,
        ].map(encodeURIComponent).join(':'),
      });
    },
  });
}

export function isWorkroomRunCancelReasonCode(value: unknown): value is WorkroomRunCancelReasonCode {
  return value === 'operator_request' || value === 'no_longer_required'
    || value === 'superseded' || value === 'policy_change';
}

export function isWorkroomRunReplanReasonCode(value: unknown): value is WorkroomRunReplanReasonCode {
  return value === 'requirements_changed' || value === 'blocker_recovery'
    || value === 'policy_change' || value === 'operator_request';
}

function requireText(value: string, label: string): void {
  if (!value.trim() || value.length > 256) throw new Error(`${label} is invalid`);
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error('Workroom Run control keys are invalid');
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
