import type { AgentCapabilities } from '../plugin-runtime/capability-ingress.js';
import {
  createDeferredCapabilityPlan,
  isReservedControlToolName,
  type DeferredCapabilityCeiling,
  type DeferredCapabilityPlan,
  type DeferredCapabilityPlanOptions,
} from '../plugin-runtime/deferred-capability-plan.js';
import type { AssignmentExecutionEnvelope } from '../workroom/assignment-executor.js';
import {
  discoverWorkroomRoleCapabilities,
  type WorkroomRoleCapabilitySnapshot,
} from '../workroom/role-capability-snapshot.js';

const WORKROOM_REALIZATION_ISSUER = Symbol('WorkroomCapabilityRealization.issuer');

export interface WorkroomDeferredCapabilityAuthority {
  readonly kind: 'workroom_assignment';
  readonly envelope: AssignmentExecutionEnvelope;
  readonly capabilitySnapshot: WorkroomRoleCapabilitySnapshot;
  readonly realization: WorkroomCapabilityRealization;
}

/** Opaque proof that one immutable capability projection was joined to this Snapshot. */
export class WorkroomCapabilityRealization {
  readonly #capabilities: AgentCapabilities;
  readonly #envelopeDigest: string;
  readonly #snapshotDigest: string;

  constructor(
    issuer: symbol,
    capabilities: AgentCapabilities,
    envelopeDigest: string,
    snapshotDigest: string,
  ) {
    if (issuer !== WORKROOM_REALIZATION_ISSUER) {
      throw new Error('Workroom capability realization requires the trusted issuer');
    }
    this.#capabilities = capabilities;
    this.#envelopeDigest = envelopeDigest;
    this.#snapshotDigest = snapshotDigest;
    Object.freeze(this);
  }

  assertBound(
    capabilities: AgentCapabilities,
    envelope: AssignmentExecutionEnvelope,
    snapshot: WorkroomRoleCapabilitySnapshot,
  ): void {
    if (capabilities !== this.#capabilities
      || envelope.digest !== this.#envelopeDigest
      || snapshot.digest !== this.#snapshotDigest) {
      throw new Error('Workroom capabilities are outside the trusted generation realization');
    }
  }
}

/** Called only by the trusted generation/Assignment projection boundary. */
export function bindWorkroomCapabilityRealization(
  capabilities: AgentCapabilities,
  envelope: AssignmentExecutionEnvelope,
  snapshot: WorkroomRoleCapabilitySnapshot,
): WorkroomCapabilityRealization {
  if (!Object.isFrozen(capabilities)
    || !Object.isFrozen(capabilities.tools)
    || !Object.isFrozen(capabilities.skills)
    || capabilities.tools.some(capability => !Object.isFrozen(capability))
    || capabilities.skills.some(capability => !Object.isFrozen(capability))) {
    throw new Error('Workroom generation capability projection must be deeply immutable');
  }
  const ceiling = discoverWorkroomRoleCapabilities(envelope, snapshot);
  assertExactRuntimeProjection(
    'Tool',
    ceiling.tools.filter(item => item.name !== 'spawn_task' && !isReservedControlToolName(item.name)),
    capabilities.tools,
    capability => capability.name,
  );
  assertExactRuntimeProjection(
    'Skill',
    ceiling.skills,
    capabilities.skills,
    capability => capability.qualifiedName,
  );
  return new WorkroomCapabilityRealization(
    WORKROOM_REALIZATION_ISSUER,
    capabilities,
    envelope.digest,
    snapshot.digest,
  );
}

export type WorkroomDeferredCapabilityPlanOptions = Omit<
  DeferredCapabilityPlanOptions,
  'authority' | 'ceiling'
> & Readonly<{ authority: WorkroomDeferredCapabilityAuthority }>;

/** Explicit Workroom entry point: callers cannot omit the Assignment ceiling. */
export function createWorkroomDeferredCapabilityPlan(
  options: WorkroomDeferredCapabilityPlanOptions,
): DeferredCapabilityPlan {
  const { authority, ...rest } = options;
  return createDeferredCapabilityPlan({ ...rest, ceiling: createWorkroomCapabilityCeiling(authority) });
}

function assertExactRuntimeProjection<
  TExpected extends Readonly<{ name: string }>,
  TRuntime,
>(
  kind: 'Tool' | 'Skill',
  expectedCapabilities: readonly TExpected[],
  runtimeCapabilities: readonly TRuntime[],
  runtimeName: (capability: TRuntime) => string,
): void {
  for (const expected of expectedCapabilities) {
    const matches = runtimeCapabilities.filter(
      capability => runtimeName(capability) === expected.name,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Workroom ${kind} ${expected.name} has ${matches.length} active generation realizations`,
      );
    }
  }
}

function createWorkroomCapabilityCeiling(
  authority: WorkroomDeferredCapabilityAuthority,
): DeferredCapabilityCeiling {
  return Object.freeze({
    project(capabilities: AgentCapabilities) {
      if (authority.kind !== 'workroom_assignment') {
        throw new Error('Unsupported deferred capability authority');
      }
      if (!(authority.realization instanceof WorkroomCapabilityRealization)) {
        throw new Error('Workroom deferred plan requires a trusted generation realization');
      }
      authority.realization.assertBound(
        capabilities,
        authority.envelope,
        authority.capabilitySnapshot,
      );
      const ceiling = discoverWorkroomRoleCapabilities(
        authority.envelope,
        authority.capabilitySnapshot,
      );
      const toolCeiling = ceiling.tools.filter(
        item => item.name !== 'spawn_task' && !isReservedControlToolName(item.name),
      );
      const toolNames = new Set(toolCeiling.map(item => item.name));
      const skillNames = new Set(ceiling.skills.map(item => item.name));
      return Object.freeze({
        tools: Object.freeze(capabilities.tools.filter(tool => toolNames.has(tool.name))),
        skills: Object.freeze(capabilities.skills.filter(skill => skillNames.has(skill.qualifiedName))),
      });
    },
  });
}
