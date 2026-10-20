import { createToken } from '@zhin.js/plugin-runtime';
import {
  WorkroomAssignmentAuthorityGrantApplication,
  type WorkroomAssignmentGrantClaimPreviewPort,
  type WorkroomAssignmentDisclosureManifestAuthorityPort,
  type WorkroomAssignmentGrantAuthorityMaterializerPort,
  type WorkroomAssignmentWorkspaceAllocatorPort,
} from '../workroom/assignment-authority-grant-application.js';
export { WorkroomAssignmentAuthorityGrantApplication } from '../workroom/assignment-authority-grant-application.js';
import type { AssignmentAuthorityGrantRepository } from '../workroom/assignment-authority-grant-repository.js';
import type {
  RemoteAssignmentDispatchCommandService,
  RemoteAssignmentDispatchRecoveryResult,
} from '../workroom/remote-assignment-dispatch-command.js';
import type {
  WorkroomRemoteAssignmentClaimRequest,
} from '../workroom/remote-assignment-issuance.js';
import type { WorkroomRemoteAssignmentIssuanceReceipt } from '../workroom/workroom-kernel.js';
import type { WorkroomDispatchTaskDecision } from '../workroom/workroom-scheduler.js';
import {
  WorkroomSchedulerAssignmentRouteUnavailableError,
  WorkroomSchedulerDurablyBlockedError,
  type RemoteWorkroomSchedulerDispatchSupplyOptions,
  type WorkroomSchedulerDispatchSupplyPort,
} from './workroom-scheduler-runtime.js';

export const workroomAssignmentGrantClaimPreviewToken =
  createToken<WorkroomAssignmentGrantClaimPreviewPort>(
    'zhin.agent.workroom-assignment-grant-claim-preview',
    'Exact Journal/Profile/Catalog remote Assignment claim preview',
  );

export const workroomAssignmentAuthorityGrantRepositoryToken =
  createToken<AssignmentAuthorityGrantRepository>(
    'zhin.agent.workroom-assignment-authority-grant-repository',
    'Durable content-addressed Assignment authority Grant/Blocker repository',
  );

export const workroomAssignmentGrantAuthorityMaterializerToken =
  createToken<WorkroomAssignmentGrantAuthorityMaterializerPort>(
    'zhin.agent.workroom-assignment-grant-authority-materializer',
    'Exact role/task/policy capability ceilings and Context Policy authority',
  );

export const workroomAssignmentWorkspaceAllocatorToken =
  createToken<WorkroomAssignmentWorkspaceAllocatorPort>(
    'zhin.agent.workroom-assignment-workspace-allocator',
    'Fenced per-Assignment Workspace/worktree allocator',
  );

export const workroomAssignmentDisclosureManifestAuthorityToken =
  createToken<WorkroomAssignmentDisclosureManifestAuthorityPort>(
    'zhin.agent.workroom-assignment-disclosure-manifest-authority',
    'P12 materialized Disclosure Manifest authority',
  );

export const workroomAssignmentAuthorityGrantApplicationToken =
  createToken<WorkroomAssignmentAuthorityGrantApplication>(
    'zhin.agent.workroom-assignment-authority-grant-application',
    'Generation-owned durable Assignment authority Grant writer',
  );

export interface GrantPreparingRemoteWorkroomSchedulerDispatchSupplyOptions
extends Omit<RemoteWorkroomSchedulerDispatchSupplyOptions, 'dispatch'> {
  readonly dispatch: Pick<RemoteAssignmentDispatchCommandService, 'issue'>;
  readonly grants: WorkroomAssignmentAuthorityGrantApplication;
}

export class WorkroomAssignmentAuthorityGrantBlockedError extends Error {
  constructor(readonly recordDigest: string) {
    super(`Remote Assignment authority is durably blocked: ${recordDigest}`);
    this.name = 'WorkroomAssignmentAuthorityGrantBlockedError';
  }
}

/** Claim producer boundary: callers cannot bypass durable grant preparation. */
export class GrantAwareRemoteAssignmentDispatchCommandService {
  constructor(readonly options: Readonly<{
    delegate: Pick<RemoteAssignmentDispatchCommandService, 'issue' | 'recover'>;
    grants: WorkroomAssignmentAuthorityGrantApplication;
  }>) {}

  async issue(
    request: WorkroomRemoteAssignmentClaimRequest,
  ): Promise<WorkroomRemoteAssignmentIssuanceReceipt> {
    const prepared = await this.options.grants.prepare(request);
    if (prepared.status === 'blocked') {
      throw new WorkroomAssignmentAuthorityGrantBlockedError(prepared.record.digest);
    }
    return await this.options.delegate.issue(request);
  }

  recover(): Promise<readonly RemoteAssignmentDispatchRecoveryResult[]> {
    return this.options.delegate.recover();
  }
}

/** Remote Scheduler adapter that persists ready/blocker authority before Kernel claim. */
export class GrantPreparingRemoteWorkroomSchedulerDispatchSupply
implements WorkroomSchedulerDispatchSupplyPort {
  constructor(readonly options: GrantPreparingRemoteWorkroomSchedulerDispatchSupplyOptions) {}

  async deliver(decision: WorkroomDispatchTaskDecision): Promise<void> {
    const catalog = await this.options.catalog.read();
    const definition = catalog.definitions[decision.projectId];
    if (!definition || definition.enabled === false) {
      throw new Error(`Workroom Scheduler Project ${decision.projectId} is not enabled in Catalog`);
    }
    const route = await this.options.route.resolve({ decision, catalog });
    if (!route || route.kind !== 'remote') {
      throw new WorkroomSchedulerAssignmentRouteUnavailableError(decision);
    }
    const agentDefinitionId = text(route.agentDefinitionId, 'agentDefinitionId');
    const endpointId = text(route.endpointId, 'endpointId');
    text(route.authorityRef, 'authorityRef');
    if (!definition.members.some(member =>
      member.role === decision.role && member.agent === agentDefinitionId)) {
      throw new Error('Workroom Scheduler Assignment route is outside the exact Catalog role binding');
    }
    let state = await this.options.runState.read(decision.projectId, decision.runId);
    let task = state.tasks[decision.taskKey];
    if (!task || task.revision !== decision.taskRevision || task.status !== 'ready') {
      throw new Error('Workroom Scheduler dispatch decision is stale for current Task state');
    }
    if (!task.acceptanceContract) {
      state = await this.options.runState.pinTaskAcceptance(
        decision.projectId,
        decision.runId,
        decision.taskKey,
      );
      task = state.tasks[decision.taskKey];
      if (!task?.acceptanceContract) {
        throw new Error('Workroom Scheduler supply failed to pin Task Acceptance Contract');
      }
    }
    const request = Object.freeze({
      operationId: decision.decisionId,
      projectId: decision.projectId,
      runId: decision.runId,
      taskKey: decision.taskKey,
      agentDefinitionId,
      endpointId,
    });
    const prepared = await this.options.grants.prepare(request);
    if (prepared.status === 'blocked') {
      throw new WorkroomSchedulerDurablyBlockedError(
        decision,
        `assignment-grant:${prepared.record.assignmentKey}:${prepared.record.digest}`,
      );
    }
    await this.options.dispatch.issue(request);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Remote Workroom Scheduler supply ${label} is required`);
  }
  return value;
}
