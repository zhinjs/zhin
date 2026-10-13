import { createToken } from '@zhin.js/plugin-runtime';
import type { WorkroomCatalogSnapshot } from '../workroom/catalog.js';
import type { ProjectProfileRegistry } from '../workroom/profile-registry.js';
import { compareCanonicalWorkroomText } from '../workroom/canonical-value.js';
import { parseWorkroomDispatchTaskDecision } from '../workroom/workroom-scheduler.js';
import type {
  WorkroomSchedulerAssignmentRoute,
  WorkroomSchedulerAssignmentRoutePort,
} from './workroom-scheduler-runtime.js';

export interface WorkroomSchedulerAssignmentRouteProvider {
  readonly providerId: string;
  readonly generation: number;
  resolve(
    input: Parameters<WorkroomSchedulerAssignmentRoutePort['resolve']>[0],
  ): Promise<WorkroomSchedulerAssignmentRoute | null>;
}

export interface GenerationOwnedWorkroomSchedulerAssignmentRouteRegistryOptions {
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly profiles: Pick<ProjectProfileRegistry, 'read'>;
}

export const workroomSchedulerAssignmentRouteRegistryToken =
  createToken<GenerationOwnedWorkroomSchedulerAssignmentRouteRegistry>(
    'zhin.agent.workroom-scheduler-assignment-route-registry',
    'Generation-owned exact local/remote Assignment route registry',
  );

/**
 * Combines independently installed local/remote route authorities without a
 * first-wins policy. Exactly one provider must prove the route against the
 * pinned Profile and current Catalog; zero or multiple candidates fail closed.
 */
export class GenerationOwnedWorkroomSchedulerAssignmentRouteRegistry
implements WorkroomSchedulerAssignmentRoutePort {
  readonly #generation: number;
  readonly #providers = new Map<string, WorkroomSchedulerAssignmentRouteProvider>();

  constructor(readonly options: GenerationOwnedWorkroomSchedulerAssignmentRouteRegistryOptions) {
    this.#generation = nonNegativeInteger(options.generation, 'generation');
  }

  get generation(): number {
    return this.#generation;
  }

  register(provider: WorkroomSchedulerAssignmentRouteProvider): () => void {
    this.options.signal.throwIfAborted();
    const providerId = text(provider.providerId, 'providerId');
    if (provider.generation !== this.#generation) {
      throw new Error('Workroom Scheduler route provider generation is stale');
    }
    if (this.#providers.has(providerId)) {
      throw new Error(`Workroom Scheduler route provider ${providerId} is already registered`);
    }
    this.#providers.set(providerId, provider);
    return () => {
      if (this.#providers.get(providerId) === provider) this.#providers.delete(providerId);
    };
  }

  async resolve(
    input: Parameters<WorkroomSchedulerAssignmentRoutePort['resolve']>[0],
  ): Promise<WorkroomSchedulerAssignmentRoute | null> {
    this.options.signal.throwIfAborted();
    const decision = parseWorkroomDispatchTaskDecision(input.decision);
    const catalog = input.catalog;
    const definition = catalog.definitions[decision.projectId];
    if (!definition || definition.enabled === false) return null;
    const pinnedAgentIds = await this.#pinnedAgentIds(decision.projectId, decision.runId, decision.role)
      .catch(() => null);
    if (!pinnedAgentIds) return null;

    const candidates: WorkroomSchedulerAssignmentRoute[] = [];
    for (const provider of [...this.#providers.values()]
      .sort((left, right) => compareCanonicalWorkroomText(left.providerId, right.providerId))) {
      this.options.signal.throwIfAborted();
      let candidate: WorkroomSchedulerAssignmentRoute | null;
      try {
        candidate = await provider.resolve({ decision, catalog });
      } catch {
        return null;
      }
      if (!candidate) continue;
      const route = parseRoute(candidate);
      const catalogMatches = definition.members.filter(member =>
        member.role === decision.role && member.agent === route.agentDefinitionId);
      if (catalogMatches.length !== 1 || !pinnedAgentIds.has(route.agentDefinitionId)) return null;
      if (!matchesPersistedRoute(catalogMatches[0]!.assignmentRoute, route)) continue;
      candidates.push(route);
    }
    return candidates.length === 1 ? candidates[0]! : null;
  }

  async #pinnedAgentIds(projectId: string, runId: string, role: string): Promise<ReadonlySet<string> | null> {
    const registry = await this.options.profiles.read(projectId);
    const pin = registry.runPins[runId];
    if (!pin || pin.projectId !== projectId || pin.runId !== runId) return null;
    const revision = registry.revisions[pin.profileRevisionId];
    if (!revision || revision.projectId !== projectId
      || revision.compiledDigest !== pin.profileDigest
      || revision.compiledProfile.revisionId !== pin.profileRevisionId
      || revision.compiledProfile.projectId !== projectId
      || revision.compiledProfile.digest !== pin.profileDigest) return null;
    const ids = revision.compiledProfile.agents
      .filter(agent => agent.role === role)
      .map(agent => agent.id);
    return new Set(ids);
  }
}

function matchesPersistedRoute(
  authority: WorkroomCatalogSnapshot['definitions'][string]['members'][number]['assignmentRoute'],
  route: WorkroomSchedulerAssignmentRoute,
): boolean {
  if (!authority || authority.kind === 'local') return route.kind === 'local';
  return route.kind === 'remote' && route.endpointId === authority.endpointId;
}

function parseRoute(value: WorkroomSchedulerAssignmentRoute): WorkroomSchedulerAssignmentRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workroom Scheduler route shape is invalid');
  }
  if (value.kind === 'local') {
    exactKeys(value, ['kind', 'agentDefinitionId', 'authorityRef']);
    return Object.freeze({
      kind: 'local',
      agentDefinitionId: text(value.agentDefinitionId, 'agentDefinitionId'),
      authorityRef: text(value.authorityRef, 'authorityRef'),
    });
  }
  if (value.kind === 'remote') {
    exactKeys(value, ['kind', 'agentDefinitionId', 'endpointId', 'authorityRef']);
    return Object.freeze({
      kind: 'remote',
      agentDefinitionId: text(value.agentDefinitionId, 'agentDefinitionId'),
      endpointId: text(value.endpointId, 'endpointId'),
      authorityRef: text(value.authorityRef, 'authorityRef'),
    });
  }
  throw new Error('Workroom Scheduler route kind is invalid');
}

function exactKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length
    || actual.some((key, index) => key !== canonical[index])) {
    throw new Error('Workroom Scheduler route keys are invalid');
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Workroom Scheduler route ${label} is invalid`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Workroom Scheduler route ${label} is invalid`);
  }
  return Number(value);
}
