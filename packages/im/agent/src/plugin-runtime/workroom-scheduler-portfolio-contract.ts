import { digestCanonicalWorkroomValue as digest } from '../workroom/canonical-value.js';
import {
  parseWorkroomDispatchTaskDecision,
  type WorkroomDispatchTaskDecision,
} from '../workroom/workroom-scheduler.js';
import type { WorkroomSchedulerAssignmentRoute } from './workroom-scheduler-runtime.js';

export function workroomSchedulerPortfolioPayloadDigest(
  decision: WorkroomDispatchTaskDecision,
  route: WorkroomSchedulerAssignmentRoute,
): string {
  const canonicalDecision = parseWorkroomDispatchTaskDecision(decision);
  return digest(Object.freeze({
    version: 1,
    schedulerDecisionDigest: canonicalDecision.digest,
    route: canonicalWorkroomSchedulerAssignmentRoute(route),
  }));
}

export function workroomSchedulerPortfolioRequestId(
  decision: WorkroomDispatchTaskDecision,
  route: WorkroomSchedulerAssignmentRoute,
): string {
  return `portfolio-request:${workroomSchedulerPortfolioPayloadDigest(decision, route).slice('sha256:'.length)}`;
}

export function workroomSchedulerPortfolioOpaqueHeadId(
  decision: WorkroomDispatchTaskDecision,
): string {
  const canonical = parseWorkroomDispatchTaskDecision(decision);
  return `portfolio-scheduler-head:${canonical.digest.slice('sha256:'.length)}`;
}

export function canonicalWorkroomSchedulerAssignmentRoute(route: WorkroomSchedulerAssignmentRoute) {
  if (route.kind === 'local') {
    exactKeys(route, ['kind', 'agentDefinitionId', 'authorityRef']);
    return Object.freeze({
      kind: 'local' as const,
      agentDefinitionId: text(route.agentDefinitionId, 'route agentDefinitionId'),
      authorityRef: text(route.authorityRef, 'route authorityRef'),
    });
  }
  exactKeys(route, ['kind', 'agentDefinitionId', 'endpointId', 'authorityRef']);
  return Object.freeze({
    kind: 'remote' as const,
    agentDefinitionId: text(route.agentDefinitionId, 'route agentDefinitionId'),
    endpointId: text(route.endpointId, 'route endpointId'),
    authorityRef: text(route.authorityRef, 'route authorityRef'),
  });
}

function exactKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length
    || actual.some((key, index) => key !== canonical[index])) {
    throw new Error('Workroom Scheduler Portfolio route keys are invalid');
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Workroom Scheduler Portfolio ${label} is invalid`);
  }
  return value;
}
