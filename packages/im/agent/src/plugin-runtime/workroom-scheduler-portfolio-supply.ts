import { createToken } from '@zhin.js/plugin-runtime';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import { parsePortfolioCapacityRequest } from '../portfolio/portfolio-journal.js';
import {
  parseWorkroomDispatchTaskDecision,
  type WorkroomDispatchTaskDecision,
} from '../workroom/workroom-scheduler.js';
import type {
  WorkroomSchedulerCapacityRequest,
  WorkroomSchedulerCapacityRequestPort,
} from './workroom-portfolio-capacity.js';
import {
  WorkroomSchedulerAssignmentRouteUnavailableError,
  type WorkroomSchedulerAssignmentRoute,
  type WorkroomSchedulerAssignmentRoutePort,
  type WorkroomSchedulerDispatchSupplyPort,
} from './workroom-scheduler-runtime.js';
import {
  workroomSchedulerPortfolioOpaqueHeadId,
  workroomSchedulerPortfolioPayloadDigest,
  workroomSchedulerPortfolioRequestId,
} from './workroom-scheduler-portfolio-contract.js';

export interface WorkroomSchedulerPortfolioRequestAuthorityPort {
  /** Pure trusted projection from pinned Profile/Catalog/Task/resource facts. */
  resolve(input: Readonly<{
    generation: number;
    decision: WorkroomDispatchTaskDecision;
    route: WorkroomSchedulerAssignmentRoute;
    catalog: Awaited<ReturnType<WorkroomCatalog['read']>>;
  }>): Promise<WorkroomSchedulerCapacityRequest | undefined>;
}

export const workroomSchedulerPortfolioRequestAuthorityToken =
  createToken<WorkroomSchedulerPortfolioRequestAuthorityPort>(
    'zhin.agent.workroom-scheduler-portfolio-request-authority',
    'Trusted pinned Profile/Catalog/Task to content-free Portfolio Capacity Request projection',
  );

export interface PortfolioFirstWorkroomSchedulerDispatchSupplyOptions {
  readonly generation: number;
  readonly catalog: Pick<WorkroomCatalog, 'read'>;
  readonly routes: WorkroomSchedulerAssignmentRoutePort;
  readonly requests: WorkroomSchedulerPortfolioRequestAuthorityPort;
  readonly capacity: WorkroomSchedulerCapacityRequestPort;
}

export class WorkroomSchedulerPortfolioCapacityUnavailableError
extends WorkroomSchedulerAssignmentRouteUnavailableError {
  constructor(decision: WorkroomDispatchTaskDecision, options?: ErrorOptions) {
    super(decision, options);
    this.name = 'WorkroomSchedulerPortfolioCapacityUnavailableError';
  }
}

/**
 * The only production Scheduler supply: it can publish a content-free Capacity
 * Request, but it has no Local/Remote Assignment issuer. The P11 Grant outbox
 * and consume-first saga own all eventual Assignment claims.
 */
export class PortfolioFirstWorkroomSchedulerDispatchSupply
implements WorkroomSchedulerDispatchSupplyPort {
  readonly #generation: number;

  constructor(readonly options: PortfolioFirstWorkroomSchedulerDispatchSupplyOptions) {
    this.#generation = nonNegativeInteger(options.generation, 'generation');
  }

  async probe(decision: WorkroomDispatchTaskDecision): Promise<boolean> {
    try {
      await this.#resolve(decision);
      return true;
    } catch {
      return false;
    }
  }

  async deliver(decision: WorkroomDispatchTaskDecision): Promise<void> {
    const exactDecision = parseWorkroomDispatchTaskDecision(decision);
    const resolved = await this.#resolve(exactDecision);
    try {
      await this.options.capacity.request(resolved.request);
    } catch (error) {
      throw new WorkroomSchedulerPortfolioCapacityUnavailableError(exactDecision, { cause: error });
    }
  }

  async #resolve(decision: WorkroomDispatchTaskDecision): Promise<Readonly<{
    route: WorkroomSchedulerAssignmentRoute;
    request: WorkroomSchedulerCapacityRequest;
  }>> {
    const catalog = await this.options.catalog.read();
    const definition = catalog.definitions[decision.projectId];
    if (!definition || definition.enabled === false) {
      throw new WorkroomSchedulerAssignmentRouteUnavailableError(decision);
    }
    const route = await this.options.routes.resolve({ decision, catalog });
    if (!route) throw new WorkroomSchedulerAssignmentRouteUnavailableError(decision);
    let proposed: WorkroomSchedulerCapacityRequest | undefined;
    try {
      proposed = await this.options.requests.resolve({
        generation: this.#generation,
        decision,
        route,
        catalog,
      });
    } catch (error) {
      throw new WorkroomSchedulerPortfolioCapacityUnavailableError(decision, { cause: error });
    }
    if (!proposed) throw new WorkroomSchedulerPortfolioCapacityUnavailableError(decision);
    const request = parseExactRequest(proposed, this.#generation, decision, route);
    return Object.freeze({ route, request });
  }
}

function parseExactRequest(
  value: WorkroomSchedulerCapacityRequest,
  generation: number,
  decision: WorkroomDispatchTaskDecision,
  route: WorkroomSchedulerAssignmentRoute,
): WorkroomSchedulerCapacityRequest {
  exactKeys(value, [
    'generation', 'portfolioId', 'tenantId', 'catalogRevision', 'catalogDigest', 'capacityRequest',
  ]);
  const capacityRequest = parsePortfolioCapacityRequest(value.capacityRequest);
  const canonical: WorkroomSchedulerCapacityRequest = Object.freeze({
    generation: nonNegativeInteger(value.generation, 'request generation'),
    portfolioId: text(value.portfolioId, 'portfolioId'),
    tenantId: text(value.tenantId, 'tenantId'),
    catalogRevision: nonNegativeInteger(value.catalogRevision, 'catalogRevision'),
    catalogDigest: canonicalDigest(value.catalogDigest, 'catalogDigest'),
    capacityRequest,
  });
  if (canonical.generation !== generation
    || capacityRequest.requestId !== workroomSchedulerPortfolioRequestId(decision, route)
    || capacityRequest.projectId !== decision.projectId
    || capacityRequest.workRef.runId !== decision.runId
    || capacityRequest.schedulerRevision !== decision.policy.digest
    || capacityRequest.schedulerSequence !== decision.expectedSequence + 1
    || capacityRequest.opaqueHeadId !== workroomSchedulerPortfolioOpaqueHeadId(decision)
    || capacityRequest.payloadDigest !== workroomSchedulerPortfolioPayloadDigest(decision, route)) {
    throw new Error('Portfolio Capacity Request is not bound to the exact Scheduler decision/route');
  }
  return canonical;
}

function exactKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length
    || actual.some((key, index) => key !== canonical[index])) {
    throw new Error('Portfolio Capacity Request exact keys are invalid');
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Portfolio Capacity Request ${label} is invalid`);
  }
  return value;
}

function canonicalDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Portfolio Capacity Request ${label} is invalid`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Portfolio Capacity Request ${label} is invalid`);
  }
  return Number(value);
}
