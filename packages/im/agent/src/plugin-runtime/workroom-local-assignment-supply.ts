import type { WorkroomCatalog } from '../workroom/catalog.js';
import type { ProjectProfileRegistry } from '../workroom/profile-registry.js';
import type { WorkroomKernel } from '../workroom/workroom-kernel.js';
import type { WorkroomDispatchTaskDecision } from '../workroom/workroom-scheduler.js';
import type { WorkroomLocalAssignmentRuntime } from './workroom-local-assignment-runtime.js';
import {
  WorkroomSchedulerAssignmentRouteUnavailableError,
  type WorkroomSchedulerAssignmentRoutePort,
  type WorkroomSchedulerDispatchSupplyPort,
} from './workroom-scheduler-runtime.js';

export interface PinnedProfileCatalogLocalAssignmentRouteOptions {
  readonly profiles: Pick<ProjectProfileRegistry, 'read'>;
}

/** Strict default: one pinned Profile/Catalog role binding or no route. */
export class PinnedProfileCatalogLocalAssignmentRoute
implements WorkroomSchedulerAssignmentRoutePort {
  constructor(readonly options: PinnedProfileCatalogLocalAssignmentRouteOptions) {}

  async resolve(input: Parameters<WorkroomSchedulerAssignmentRoutePort['resolve']>[0]) {
    const { decision, catalog } = input;
    const definition = catalog.definitions[decision.projectId];
    if (!definition || definition.enabled === false) return null;
    const profile = await this.options.profiles.read(decision.projectId);
    const pin = profile.runPins[decision.runId];
    if (!pin) return null;
    const revision = profile.revisions[pin.profileRevisionId];
    if (!revision
      || revision.projectId !== decision.projectId
      || revision.compiledDigest !== pin.profileDigest
      || revision.compiledProfile.revisionId !== pin.profileRevisionId
      || revision.compiledProfile.projectId !== decision.projectId
      || revision.compiledProfile.digest !== pin.profileDigest) {
      return null;
    }
    const catalogAgents = new Set(definition.members
      .filter(member => member.role === decision.role
        && (!member.assignmentRoute || member.assignmentRoute.kind === 'local'))
      .map(member => member.agent));
    const exact = revision.compiledProfile.agents.filter(agent =>
      agent.role === decision.role && catalogAgents.has(agent.id));
    if (exact.length !== 1) return null;
    return Object.freeze({
      kind: 'local' as const,
      agentDefinitionId: exact[0]!.id,
      authorityRef: `profile:${pin.profileRevisionId}:${pin.profileDigest}:catalog:${catalog.revision}`,
    });
  }
}

export interface LocalWorkroomSchedulerDispatchSupplyOptions {
  readonly catalog: Pick<WorkroomCatalog, 'read'>;
  readonly runState: Readonly<{
    read(projectId: string, runId: string): ReturnType<WorkroomKernel['read']>;
    pinTaskAcceptance(
      projectId: string,
      runId: string,
      taskKey: string,
    ): ReturnType<WorkroomKernel['pinTaskAcceptance']>;
  }>;
  readonly kernel: Pick<WorkroomKernel, 'issueLocalAssignment'>;
  readonly runtime: Pick<WorkroomLocalAssignmentRuntime, 'dispatch'>;
  readonly route: WorkroomSchedulerAssignmentRoutePort;
  readonly assertReady?: (decision: WorkroomDispatchTaskDecision) => void | Promise<void>;
}

/** Kernel-owned claim/Envelope issuer for exact local Scheduler routes. */
export class LocalWorkroomSchedulerDispatchSupply
implements WorkroomSchedulerDispatchSupplyPort {
  constructor(readonly options: LocalWorkroomSchedulerDispatchSupplyOptions) {}

  async probe(decision: WorkroomDispatchTaskDecision): Promise<boolean> {
    try {
      const { definition, route } = await this.#resolveRoute(decision);
      await this.options.assertReady?.(decision);
      return definition.members.some(member =>
        member.role === decision.role && member.agent === route.agentDefinitionId);
    } catch {
      return false;
    }
  }

  async deliver(decision: WorkroomDispatchTaskDecision): Promise<void> {
    const { definition, route } = await this.#resolveRoute(decision);
    try {
      await this.options.assertReady?.(decision);
    } catch (error) {
      throw new WorkroomSchedulerAssignmentRouteUnavailableError(decision, { cause: error });
    }
    if (!definition.members.some(member =>
      member.role === decision.role && member.agent === route.agentDefinitionId)) {
      throw new Error('Local Workroom Scheduler route is outside the exact Catalog role binding');
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
        throw new Error('Local Workroom Scheduler supply failed to pin Task Acceptance Contract');
      }
    }
    let issued: Awaited<ReturnType<WorkroomKernel['issueLocalAssignment']>>;
    try {
      issued = await this.options.kernel.issueLocalAssignment({
        operationId: decision.decisionId,
        projectId: decision.projectId,
        runId: decision.runId,
        taskKey: decision.taskKey,
        agentDefinitionId: route.agentDefinitionId,
      });
    } catch (error) {
      throw new WorkroomSchedulerAssignmentRouteUnavailableError(decision, { cause: error });
    }
    this.options.runtime.dispatch(issued.envelope);
  }

  async #resolveRoute(decision: WorkroomDispatchTaskDecision) {
    const catalog = await this.options.catalog.read();
    const definition = catalog.definitions[decision.projectId];
    if (!definition || definition.enabled === false) {
      throw new WorkroomSchedulerAssignmentRouteUnavailableError(decision);
    }
    const route = await this.options.route.resolve({ decision, catalog });
    if (!route || route.kind !== 'local') {
      throw new WorkroomSchedulerAssignmentRouteUnavailableError(decision);
    }
    return { definition, route };
  }
}
