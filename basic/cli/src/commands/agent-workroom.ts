import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import {
  isWorkroomRunCancelReasonCode,
  isWorkroomRunReplanReasonCode,
  type WorkroomAssignmentState,
  type WorkroomAssignmentStatus,
  type WorkroomBlockerKind,
  type WorkroomExecutionRole,
  type WorkroomReadinessState,
  type WorkroomRunStatus,
  type WorkroomRunCancelReasonCode,
  type WorkroomRunReplanReasonCode,
  type WorkroomTaskStatus,
} from '@zhin.js/agent';
import { hostGet, hostPost, loadHostHttpConfig } from '../utils/host-http.js';

type WorkroomAssignmentOutcome = NonNullable<WorkroomAssignmentState['outcome']>;

export interface WorkroomRunsCommandOptions {
  readonly projectId: string;
  readonly json?: boolean;
}

export interface WorkroomRunCommandOptions extends WorkroomRunsCommandOptions {
  readonly runId: string;
}

export interface WorkroomReadinessCommandOptions extends WorkroomRunCommandOptions {}

export interface WorkroomCancelCommandOptions extends WorkroomRunCommandOptions {
  readonly expectedSequence: number;
  readonly reasonCode: WorkroomRunCancelReasonCode;
  readonly controlDeadline: number;
  readonly operationId?: string;
}

export interface WorkroomRequestReplanCommandOptions extends WorkroomRunCommandOptions {
  readonly expectedSequence: number;
  readonly reasonCode: WorkroomRunReplanReasonCode;
  readonly operationId?: string;
}

export interface WorkroomRunHeaderOutput {
  readonly version: 1;
  readonly projectId: string;
  readonly runId: string;
  readonly status: WorkroomRunStatus;
  readonly sequence: number;
  readonly cancelRequested: boolean;
  readonly counts: Readonly<{
    tasks: number;
    assignments: number;
    reviewerAssignments: number;
    sponsorGates: number;
  }>;
  readonly authorityDigest: string;
  readonly digest: string;
}

export interface WorkroomRunsOutput {
  readonly projectId: string;
  readonly runs: readonly WorkroomRunHeaderOutput[];
}

export interface WorkroomTaskHeaderOutput {
  readonly version: 1;
  readonly ref: string;
  readonly status: WorkroomTaskStatus;
  readonly revision: number;
  readonly attempt: number;
  readonly required: boolean;
  readonly blockerCount: number;
  readonly hasCurrentAssignment: boolean;
  readonly digest: string;
}

export interface WorkroomAssignmentHeaderOutput {
  readonly version: 1;
  readonly ref: string;
  readonly taskRef: string;
  readonly status: WorkroomAssignmentStatus;
  readonly role: WorkroomExecutionRole;
  readonly revision: number;
  readonly attempt: number;
  readonly fence: number;
  readonly outcome?: WorkroomAssignmentOutcome;
  readonly digest: string;
}

export interface WorkroomRunOutput extends WorkroomRunHeaderOutput {
  readonly tasks: readonly WorkroomTaskHeaderOutput[];
  readonly assignments: readonly WorkroomAssignmentHeaderOutput[];
}

export interface WorkroomReadinessBlockerOutput {
  readonly version: 1;
  readonly taskRef: string;
  readonly blockerRef: string;
  readonly kind: WorkroomBlockerKind | 'unknown';
  readonly deadline?: number;
  readonly allowedActions: readonly ('resolve' | 'replan' | 'cancel')[];
  readonly digest: string;
}

export interface WorkroomReadinessOutput {
  readonly version: 1;
  readonly projectId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly state: WorkroomReadinessState;
  readonly blockers: readonly WorkroomReadinessBlockerOutput[];
  readonly recommendedActions: readonly ('resolve' | 'replan' | 'cancel')[];
  readonly authorityDigest: string;
  readonly digest: string;
}

export interface WorkroomControlOutput {
  readonly status: 'committed' | 'duplicate';
  readonly action: 'cancel' | 'request_replan';
  readonly operationId: string;
  readonly receiptRef: string;
  readonly receiptDigest: string;
  readonly run: Readonly<{
    projectId: string;
    runId: string;
    status: WorkroomRunStatus;
    sequence: number;
  }>;
}

export async function executeWorkroomRunsCommand(
  options: WorkroomRunsCommandOptions,
  cwd = process.cwd(),
): Promise<WorkroomRunsOutput> {
  const projectId = requireIdentifier(options.projectId, 'Project');
  const value = await readWorkroomHost(
    `/agent/workroom/runs?projectId=${encodeURIComponent(projectId)}`,
    cwd,
  );
  const output = parseWorkroomRunsOutput(value, projectId);
  console.log(options.json ? JSON.stringify(output, null, 2) : formatWorkroomRuns(output));
  return output;
}

export async function executeWorkroomRunCommand(
  options: WorkroomRunCommandOptions,
  cwd = process.cwd(),
): Promise<WorkroomRunOutput> {
  const projectId = requireIdentifier(options.projectId, 'Project');
  const runId = requirePathIdentifier(options.runId, 'Run');
  const value = await readWorkroomHost(
    `/agent/workroom/runs/${encodeURIComponent(runId)}?projectId=${encodeURIComponent(projectId)}`,
    cwd,
  );
  const output = parseWorkroomRunOutput(value, projectId, runId);
  console.log(options.json ? JSON.stringify(output, null, 2) : formatWorkroomRun(output));
  return output;
}

export async function executeWorkroomReadinessCommand(
  options: WorkroomReadinessCommandOptions,
  cwd = process.cwd(),
): Promise<WorkroomReadinessOutput> {
  const projectId = requireIdentifier(options.projectId, 'Project');
  const runId = requirePathIdentifier(options.runId, 'Run');
  const value = await readWorkroomHost(
    `/agent/workroom/readiness?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(runId)}`,
    cwd,
  );
  const output = parseWorkroomReadinessOutput(value, projectId, runId);
  console.log(options.json ? JSON.stringify(output, null, 2) : formatWorkroomReadiness(output));
  return output;
}

export async function executeWorkroomCancelCommand(
  options: WorkroomCancelCommandOptions,
  cwd = process.cwd(),
): Promise<WorkroomControlOutput> {
  const common = normalizeControlOptions(options);
  if (!isCancelReasonCode(options.reasonCode)) throw new Error('Cancellation reasonCode 无效');
  const controlDeadline = requireNonNegativeInteger(options.controlDeadline, 'controlDeadline');
  return executeWorkroomControl({
    version: 1,
    ...common,
    action: 'cancel',
    reasonCode: options.reasonCode,
    controlDeadline,
  }, options.json === true, cwd);
}

export async function executeWorkroomRequestReplanCommand(
  options: WorkroomRequestReplanCommandOptions,
  cwd = process.cwd(),
): Promise<WorkroomControlOutput> {
  const common = normalizeControlOptions(options);
  if (!isReplanReasonCode(options.reasonCode)) throw new Error('Replan reasonCode 无效');
  return executeWorkroomControl({
    version: 1,
    ...common,
    action: 'request_replan',
    reasonCode: options.reasonCode,
  }, options.json === true, cwd);
}

export function registerWorkroomOnlineCommands(agentCommand: Command): void {
  const workroom = agentCommand
    .command('workroom')
    .description('Inspect the running Workroom through the authenticated Host API');

  workroom
    .command('runs')
    .description('List content-free Run status for one Project')
    .requiredOption('--project <projectId>', 'Exact Workroom Project id')
    .option('--json', 'Output JSON')
    .action((options: Readonly<{ project: string; json?: boolean }>) => {
      runOnlineAction(() => executeWorkroomRunsCommand({
        projectId: options.project,
        ...(options.json ? { json: true } : {}),
      }));
    });

  workroom
    .command('run <runId>')
    .description('Inspect content-free Task and Assignment status for one Run')
    .requiredOption('--project <projectId>', 'Exact Workroom Project id')
    .option('--json', 'Output JSON')
    .action((runId: string, options: Readonly<{ project: string; json?: boolean }>) => {
      runOnlineAction(() => executeWorkroomRunCommand({
        projectId: options.project,
        runId,
        ...(options.json ? { json: true } : {}),
      }));
    });

  workroom
    .command('readiness <runId>')
    .description('Diagnose content-free blockers and allowed actions for one Run')
    .requiredOption('--project <projectId>', 'Exact Workroom Project id')
    .option('--json', 'Output JSON')
    .action((runId: string, options: Readonly<{ project: string; json?: boolean }>) => {
      runOnlineAction(() => executeWorkroomReadinessCommand({
        projectId: options.project,
        runId,
        ...(options.json ? { json: true } : {}),
      }));
    });

  workroom
    .command('cancel <runId>')
    .description('Request an exact-sequence, Sponsor-authorized Run cancellation')
    .requiredOption('--project <projectId>', 'Exact Workroom Project id')
    .requiredOption('--expected-sequence <sequence>', 'Current Run sequence')
    .requiredOption('--reason-code <code>', 'operator_request|no_longer_required|superseded|policy_change')
    .requiredOption('--control-deadline <timestamp>', 'Kernel control deadline')
    .option('--operation-id <operationId>', 'Stable idempotency key')
    .option('--json', 'Output JSON')
    .action((runId: string, options: Readonly<{
      project: string; expectedSequence: string; reasonCode: WorkroomRunCancelReasonCode;
      controlDeadline: string; operationId?: string; json?: boolean;
    }>) => {
      runOnlineAction(() => executeWorkroomCancelCommand({
        projectId: options.project,
        runId,
        expectedSequence: parseIntegerOption(options.expectedSequence, 'expected-sequence'),
        reasonCode: options.reasonCode,
        controlDeadline: parseIntegerOption(options.controlDeadline, 'control-deadline'),
        ...(options.operationId ? { operationId: options.operationId } : {}),
        ...(options.json ? { json: true } : {}),
      }));
    });

  workroom
    .command('request-replan <runId>')
    .description('Persist an exact-sequence, Sponsor-authorized replan request')
    .requiredOption('--project <projectId>', 'Exact Workroom Project id')
    .requiredOption('--expected-sequence <sequence>', 'Current Run sequence')
    .requiredOption('--reason-code <code>', 'requirements_changed|blocker_recovery|policy_change|operator_request')
    .option('--operation-id <operationId>', 'Stable idempotency key')
    .option('--json', 'Output JSON')
    .action((runId: string, options: Readonly<{
      project: string; expectedSequence: string; reasonCode: WorkroomRunReplanReasonCode;
      operationId?: string; json?: boolean;
    }>) => {
      runOnlineAction(() => executeWorkroomRequestReplanCommand({
        projectId: options.project,
        runId,
        expectedSequence: parseIntegerOption(options.expectedSequence, 'expected-sequence'),
        reasonCode: options.reasonCode,
        ...(options.operationId ? { operationId: options.operationId } : {}),
        ...(options.json ? { json: true } : {}),
      }));
    });
}

function parseWorkroomRunsOutput(value: unknown, expectedProjectId: string): WorkroomRunsOutput {
  if (!isRecord(value) || value.projectId !== expectedProjectId || !Array.isArray(value.runs)) {
    throw new Error('Host 返回了无效的 Workroom Run 列表');
  }
  return Object.freeze({
    projectId: expectedProjectId,
    runs: Object.freeze(value.runs.map((run, index) => parseRunHeader(run, index, expectedProjectId))),
  });
}

function parseRunHeader(value: unknown, index: number, projectId: string): WorkroomRunHeaderOutput {
  if (!isRecord(value) || value.version !== 1 || value.projectId !== projectId
    || !nonEmptyString(value.runId) || !isRunStatus(value.status)
    || !nonNegativeInteger(value.sequence) || typeof value.cancelRequested !== 'boolean'
    || !isRecord(value.counts) || !nonNegativeInteger(value.counts.tasks)
    || !nonNegativeInteger(value.counts.assignments)
    || !nonNegativeInteger(value.counts.reviewerAssignments)
    || !nonNegativeInteger(value.counts.sponsorGates)
    || !nonEmptyString(value.authorityDigest) || !nonEmptyString(value.digest)) {
    throw new Error(`Host 返回了无效的 Workroom Run header（索引 ${index}）`);
  }
  return Object.freeze({
    version: 1,
    projectId,
    runId: value.runId,
    status: value.status,
    sequence: value.sequence,
    cancelRequested: value.cancelRequested,
    counts: Object.freeze({
      tasks: value.counts.tasks,
      assignments: value.counts.assignments,
      reviewerAssignments: value.counts.reviewerAssignments,
      sponsorGates: value.counts.sponsorGates,
    }),
    authorityDigest: value.authorityDigest,
    digest: value.digest,
  });
}

function parseWorkroomRunOutput(
  value: unknown,
  projectId: string,
  runId: string,
): WorkroomRunOutput {
  const header = parseRunHeader(value, 0, projectId);
  if (header.runId !== runId || !isRecord(value)
    || !Array.isArray(value.tasks) || !Array.isArray(value.assignments)) {
    throw new Error('Host 返回了无效的 Workroom Run detail');
  }
  return Object.freeze({
    ...header,
    tasks: Object.freeze(value.tasks.map((task, index) => parseTaskHeader(task, index))),
    assignments: Object.freeze(
      value.assignments.map((assignment, index) => parseAssignmentHeader(assignment, index)),
    ),
  });
}

function parseTaskHeader(value: unknown, index: number): WorkroomTaskHeaderOutput {
  if (!isRecord(value) || value.version !== 1 || !nonEmptyString(value.ref)
    || !isTaskStatus(value.status) || !nonNegativeInteger(value.revision)
    || !nonNegativeInteger(value.attempt) || typeof value.required !== 'boolean'
    || !nonNegativeInteger(value.blockerCount) || typeof value.hasCurrentAssignment !== 'boolean'
    || !nonEmptyString(value.digest)) {
    throw new Error(`Host 返回了无效的 Workroom Task header（索引 ${index}）`);
  }
  return Object.freeze({
    version: 1,
    ref: value.ref,
    status: value.status,
    revision: value.revision,
    attempt: value.attempt,
    required: value.required,
    blockerCount: value.blockerCount,
    hasCurrentAssignment: value.hasCurrentAssignment,
    digest: value.digest,
  });
}

function parseAssignmentHeader(value: unknown, index: number): WorkroomAssignmentHeaderOutput {
  if (!isRecord(value) || value.version !== 1 || !nonEmptyString(value.ref)
    || !nonEmptyString(value.taskRef) || !isAssignmentStatus(value.status) || !isExecutionRole(value.role)
    || !nonNegativeInteger(value.revision) || !nonNegativeInteger(value.attempt)
    || !nonNegativeInteger(value.fence) || value.outcome !== undefined && !isAssignmentOutcome(value.outcome)
    || !nonEmptyString(value.digest)) {
    throw new Error(`Host 返回了无效的 Workroom Assignment header（索引 ${index}）`);
  }
  return Object.freeze({
    version: 1,
    ref: value.ref,
    taskRef: value.taskRef,
    status: value.status,
    role: value.role,
    revision: value.revision,
    attempt: value.attempt,
    fence: value.fence,
    ...(value.outcome === undefined ? {} : { outcome: value.outcome }),
    digest: value.digest,
  });
}

function parseWorkroomReadinessOutput(
  value: unknown,
  projectId: string,
  runId: string,
): WorkroomReadinessOutput {
  if (!isRecord(value) || value.version !== 1 || value.projectId !== projectId
    || value.runId !== runId || !nonNegativeInteger(value.sequence)
    || !isReadinessState(value.state) || !Array.isArray(value.blockers)
    || !isBlockerActions(value.recommendedActions)
    || !nonEmptyString(value.authorityDigest) || !nonEmptyString(value.digest)) {
    throw new Error('Host 返回了无效的 Workroom readiness');
  }
  return Object.freeze({
    version: 1,
    projectId,
    runId,
    sequence: value.sequence,
    state: value.state,
    blockers: Object.freeze(value.blockers.map((blocker, index) =>
      parseReadinessBlocker(blocker, index))),
    recommendedActions: Object.freeze([...value.recommendedActions]),
    authorityDigest: value.authorityDigest,
    digest: value.digest,
  });
}

function parseReadinessBlocker(value: unknown, index: number): WorkroomReadinessBlockerOutput {
  if (!isRecord(value) || value.version !== 1 || !nonEmptyString(value.taskRef)
    || !nonEmptyString(value.blockerRef) || value.kind !== 'unknown' && !isBlockerKind(value.kind)
    || value.deadline !== undefined && !nonNegativeInteger(value.deadline)
    || !isBlockerActions(value.allowedActions)
    || !nonEmptyString(value.digest)) {
    throw new Error(`Host 返回了无效的 Workroom Blocker header（索引 ${index}）`);
  }
  return Object.freeze({
    version: 1,
    taskRef: value.taskRef,
    blockerRef: value.blockerRef,
    kind: value.kind,
    ...(value.deadline === undefined ? {} : { deadline: value.deadline }),
    allowedActions: Object.freeze([...value.allowedActions]),
    digest: value.digest,
  });
}

function normalizeControlOptions(
  options: WorkroomRunCommandOptions & Readonly<{ expectedSequence: number; operationId?: string }>,
): Readonly<{
  operationId: string;
  projectId: string;
  runId: string;
  expectedSequence: number;
}> {
  return Object.freeze({
    operationId: options.operationId
      ? requireIdentifier(options.operationId, 'Operation')
      : randomUUID(),
    projectId: requireIdentifier(options.projectId, 'Project'),
    runId: requirePathIdentifier(options.runId, 'Run'),
    expectedSequence: requireNonNegativeInteger(options.expectedSequence, 'expectedSequence'),
  });
}

async function executeWorkroomControl(
  command: Readonly<Record<string, unknown>>,
  json: boolean,
  cwd: string,
): Promise<WorkroomControlOutput> {
  const http = await loadHostHttpConfig(cwd);
  if (!http) throw new Error('未找到 zhin.config，无法确定 Host API 地址');
  if (!http.token.trim()) {
    throw new Error('Host API token 未配置；请配置绑定 principal 的 full scope token');
  }
  const response = await hostPost<unknown>(http, '/agent/workroom/control', command);
  if (!response.ok) {
    throw new Error(response.error ?? `控制 Workroom Run 失败（HTTP ${response.status}）`);
  }
  const output = parseWorkroomControlOutput(response.data);
  console.log(json ? JSON.stringify(output, null, 2) : formatWorkroomControl(output));
  return output;
}

function parseWorkroomControlOutput(value: unknown): WorkroomControlOutput {
  if (!isRecord(value) || value.status !== 'committed' && value.status !== 'duplicate'
    || value.action !== 'cancel' && value.action !== 'request_replan'
    || !nonEmptyString(value.operationId) || !nonEmptyString(value.receiptRef)
    || !nonEmptyString(value.receiptDigest) || !isRecord(value.run)
    || !nonEmptyString(value.run.projectId) || !nonEmptyString(value.run.runId)
    || !isRunStatus(value.run.status) || !nonNegativeInteger(value.run.sequence)) {
    throw new Error('Host 返回了无效的 Workroom control receipt');
  }
  return Object.freeze({
    status: value.status,
    action: value.action,
    operationId: value.operationId,
    receiptRef: value.receiptRef,
    receiptDigest: value.receiptDigest,
    run: Object.freeze({
      projectId: value.run.projectId,
      runId: value.run.runId,
      status: value.run.status,
      sequence: value.run.sequence,
    }),
  });
}

function formatWorkroomRuns(output: WorkroomRunsOutput): string {
  if (output.runs.length === 0) return `Workroom runs · ${output.projectId}\n(none)`;
  const rows = output.runs.map(run => [
    run.runId,
    run.status,
    String(run.sequence),
    String(run.counts.tasks),
    String(run.counts.assignments),
    String(run.counts.reviewerAssignments),
    String(run.counts.sponsorGates),
    run.cancelRequested ? 'yes' : 'no',
  ]);
  return [
    `Workroom runs · ${output.projectId}`,
    formatTable(
      ['RUN', 'STATUS', 'SEQ', 'TASKS', 'ASSIGNMENTS', 'REVIEWERS', 'GATES', 'CANCEL'],
      rows,
    ),
  ].join('\n');
}

function formatWorkroomRun(output: WorkroomRunOutput): string {
  const taskRows = output.tasks.map(task => [
    task.ref,
    task.status,
    String(task.revision),
    String(task.attempt),
    task.required ? 'yes' : 'no',
    String(task.blockerCount),
    task.hasCurrentAssignment ? 'yes' : 'no',
  ]);
  const assignmentRows = output.assignments.map(assignment => [
    assignment.ref,
    assignment.taskRef,
    assignment.status,
    assignment.role,
    String(assignment.revision),
    String(assignment.attempt),
    String(assignment.fence),
    assignment.outcome ?? '-',
  ]);
  return [
    `Workroom run · ${output.projectId}/${output.runId} · ${output.status} · seq ${output.sequence}`,
    '',
    'Tasks',
    taskRows.length === 0
      ? '(none)'
      : formatTable(
          ['TASK', 'STATUS', 'REV', 'ATTEMPT', 'REQUIRED', 'BLOCKERS', 'ASSIGNED'],
          taskRows,
        ),
    '',
    'Assignments',
    assignmentRows.length === 0
      ? '(none)'
      : formatTable(
          ['ASSIGNMENT', 'TASK', 'STATUS', 'ROLE', 'REV', 'ATTEMPT', 'FENCE', 'OUTCOME'],
          assignmentRows,
        ),
  ].join('\n');
}

function formatWorkroomReadiness(output: WorkroomReadinessOutput): string {
  const rows = output.blockers.map(blocker => [
    blocker.taskRef,
    blocker.blockerRef,
    blocker.kind,
    blocker.deadline === undefined ? '-' : String(blocker.deadline),
    blocker.allowedActions.join(','),
  ]);
  return [
    `Workroom readiness · ${output.projectId}/${output.runId} · ${output.state} · seq ${output.sequence}`,
    rows.length === 0
      ? '(no active blockers)'
      : formatTable(['TASK', 'BLOCKER', 'KIND', 'DEADLINE', 'ACTIONS'], rows),
    `Recommended: ${output.recommendedActions.length > 0
      ? output.recommendedActions.join(', ')
      : 'none'}`,
  ].join('\n');
}

function formatWorkroomControl(output: WorkroomControlOutput): string {
  return [
    'Workroom control', output.action, output.status,
    `${output.run.projectId}/${output.run.runId}`, output.run.status, `seq ${output.run.sequence}`,
  ].join(' · ');
}

function formatTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map(row => row[index]?.length ?? 0),
  ));
  return [headers, ...rows]
    .map(row => row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join('  ').trimEnd())
    .join('\n');
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new Error(`${label} id 无效`);
  return normalized;
}

function requirePathIdentifier(value: string, label: string): string {
  const normalized = requireIdentifier(value, label);
  if (/[/?#]/u.test(normalized)) throw new Error(`${label} id 无效`);
  return normalized;
}

function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 无效`);
  return value;
}

function parseIntegerOption(value: string, label: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${label} 无效`);
  return requireNonNegativeInteger(Number(value), label);
}

async function readWorkroomHost(apiPath: string, cwd: string): Promise<unknown> {
  const http = await loadHostHttpConfig(cwd);
  if (!http) throw new Error('未找到 zhin.config，无法确定 Host API 地址');
  if (!http.token.trim()) {
    throw new Error('Host API token 未配置；请配置绑定 principal 的 full scope token');
  }
  const response = await hostGet<unknown>(http, apiPath);
  if (!response.ok) {
    throw new Error(response.error ?? `读取 Workroom Run 失败（HTTP ${response.status}）`);
  }
  return response.data;
}

function runOnlineAction(action: () => Promise<unknown>): void {
  void action().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRunStatus(value: unknown): value is WorkroomRunStatus {
  return value === 'active' || value === 'blocked' || value === 'needs_replan'
    || value === 'cancelling' || value === 'completed' || value === 'cancelled';
}

function isTaskStatus(value: unknown): value is WorkroomTaskStatus {
  return value === 'ready' || value === 'blocked' || value === 'executing'
    || value === 'awaiting_acceptance' || value === 'cancelling' || value === 'accepted'
    || value === 'failed' || value === 'cancelled';
}

function isAssignmentStatus(value: unknown): value is WorkroomAssignmentStatus {
  return value === 'leased' || value === 'running' || value === 'cancel_requested'
    || value === 'execution_completed' || value === 'lost' || value === 'cancelled';
}

function isExecutionRole(value: unknown): value is WorkroomExecutionRole {
  return value === 'executor' || value === 'reviewer' || value === 'integration';
}

function isAssignmentOutcome(value: unknown): value is WorkroomAssignmentOutcome {
  return value === 'interrupted' || value === 'committed' || value === 'outcome_unknown';
}

function isReadinessState(value: unknown): value is WorkroomReadinessState {
  return value === 'ready' || value === 'blocked' || value === 'needs_replan'
    || value === 'cancelling' || value === 'terminal';
}

function isBlockerKind(value: unknown): value is WorkroomBlockerKind {
  return value === 'dependency' || value === 'approval' || value === 'capability'
    || value === 'external' || value === 'human_input';
}

function isBlockerActions(
  value: unknown,
): value is readonly ('resolve' | 'replan' | 'cancel')[] {
  return Array.isArray(value)
    && value.every(action => action === 'resolve' || action === 'replan' || action === 'cancel');
}

function isCancelReasonCode(value: unknown): value is WorkroomRunCancelReasonCode {
  return isWorkroomRunCancelReasonCode(value);
}

function isReplanReasonCode(value: unknown): value is WorkroomRunReplanReasonCode {
  return isWorkroomRunReplanReasonCode(value);
}
