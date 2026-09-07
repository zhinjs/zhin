import type { AssignmentExecutorPort } from '../workroom/assignment-executor.js';
import type { WorkroomDeliveryProviderPort } from './workroom-delivery-gateway.js';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import { digestWorkroomCatalogProjectBinding } from '../workroom/catalog-definition.js';
import type { ProjectProfileRegistry } from '../workroom/profile-registry.js';
import type { WorkroomKernel } from '../workroom/workroom-kernel.js';
import type { KernelPlanAdmissionRunProfilePinWriter } from './workroom-run-profile-pin-authority.js';
import { SelfDeliveryProject, type SelfDeliveryProjectPorts } from './self-delivery-project.js';

/** Explicit trusted embedding configuration; never sourced from plugin configuration or model text. */
export type SelfDeliveryHostConfiguration = Omit<SelfDeliveryProjectPorts, 'kernel'> & {
  readonly codingExecutor?: AssignmentExecutorPort;
  readonly deliveryProvider?: WorkroomDeliveryProviderPort;
};

/** Composition-root private writers are captured here and never published in a Resource. */
export function createSelfDeliveryProjectForHost(input: {
  directory: string;
  configuration: SelfDeliveryHostConfiguration;
  kernel: Pick<WorkroomKernel, 'admitWorkflowPlan' | 'readWorkflowPlanAdmission'>;
  catalog: Pick<WorkroomCatalog, 'read'>;
  profiles: Pick<ProjectProfileRegistry, 'read'>;
  pins: Pick<KernelPlanAdmissionRunProfilePinWriter, 'afterPlanAdmission'>;
  signal: AbortSignal;
}): SelfDeliveryProject {
  const config = input.configuration;
  const authority = async () => {
    input.signal.throwIfAborted();
    const [catalog, profiles] = await Promise.all([input.catalog.read(), input.profiles.read(config.profile.projectId)]);
    const definition = catalog.definitions[config.profile.projectId];
    if (!definition || definition.enabled === false || definition.conversation?.kind !== 'repository'
      || definition.conversation.id !== 'zhinjs/zhin') throw new Error('Self-delivery Catalog repository binding is unavailable');
    if (!profiles.active) throw new Error('Self-delivery active Profile is unavailable');
    return { catalog, profiles, definition };
  };
  return new SelfDeliveryProject(input.directory, {
    ...config,
    async authenticate(identity) {
      const actor = await config.authenticate(identity);
      const { definition } = await authority();
      return actor && definition.sponsors?.includes(actor.principalId) ? actor : undefined;
    },
    async readiness() {
      try { await authority(); } catch { return ['Catalog repository binding or active Profile is unavailable']; }
      const blockers = [...await config.readiness()];
      if (!config.codingExecutor) blockers.push('Coding Executor is not installed');
      if (!config.deliveryProvider) blockers.push('Delivery provider is not installed');
      return blockers;
    },
    kernel: {
      readWorkflowPlanAdmission: operationId => input.kernel.readWorkflowPlanAdmission(operationId),
      async admitWorkflowPlan(admission) {
        const { catalog, profiles, definition } = await authority();
        const pin = admission.plan.authority;
        const existing = await input.kernel.readWorkflowPlanAdmission(admission.operationId);
        if (!existing && (pin.projectRevision !== catalog.revision
          || pin.projectDigest !== digestWorkroomCatalogProjectBinding(definition)
          || pin.profileRevisionId !== profiles.active!.revisionId
          || pin.profileDigest !== profiles.active!.compiledDigest)) throw new Error('Self-delivery planning authority is stale');
        if (!definition.sponsors?.includes(admission.plan.tasks.find(task => task.key === 'release')?.approvalGate?.owner ?? '')) throw new Error('Self-delivery Sponsor authority was revoked');
        input.signal.throwIfAborted();
        const receipt = await input.kernel.admitWorkflowPlan(admission);
        const profile = profiles.runPins[receipt.runId];
        if (!profile) await input.pins.afterPlanAdmission({ operationId: admission.operationId,
          projectId: admission.projectId, plan: admission.plan, receipt }, input.signal);
        else if (profile.profileRevisionId !== pin.profileRevisionId || profile.profileDigest !== pin.profileDigest) throw new Error('Self-delivery Run Profile pin drift');
        return receipt;
      },
    },
  });
}

/** Preserve standard execution for sibling projects and other stages. Never fall back for coding. */
export function createSelfDeliveryAssignmentExecutor(configuration: SelfDeliveryHostConfiguration, fallback: AssignmentExecutorPort): AssignmentExecutorPort {
  return {
    execute(envelope, signal) {
      if (envelope.projectId !== configuration.profile.projectId || envelope.taskKey !== 'implement') return fallback.execute(envelope, signal);
      const executor = configuration.codingExecutor;
      if (!executor) throw new Error('Self-delivery Coding Executor is not installed');
      return executor.execute(envelope, signal);
    },
  };
}
