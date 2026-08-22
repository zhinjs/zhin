import { vi } from 'vitest';
import {
  PortfolioGrantAssignmentAuthority,
  PortfolioGrantAssignmentCompensatedError,
  WorkroomPortfolioGrantAssignmentSaga,
  portfolioGrantAssignmentBinding,
  portfolioGrantAssignmentIssuerPreview,
  type PortfolioGrantAssignmentClaim,
  type PortfolioGrantAssignmentIssueResult,
} from '../../src/plugin-runtime/workroom-portfolio-grant-assignment.js';
import {
  workroomSchedulerPortfolioOpaqueHeadId,
  workroomSchedulerPortfolioPayloadDigest,
  workroomSchedulerPortfolioRequestId,
} from '../../src/plugin-runtime/workroom-scheduler-portfolio-contract.js';
import {
  PortfolioAdmissionApplication,
  portfolioCapacityRequestDigest,
  portfolioValidatedBundleDigest,
} from '../../src/portfolio/portfolio-admission.js';
import {
  MemoryPortfolioControlOutboxRepository,
  createPortfolioControlItem,
  replayPortfolioControlOutbox,
} from '../../src/portfolio/capacity-control-outbox.js';
import {
  InMemoryPortfolioJournalRepository,
  createPortfolioPolicySnapshot,
  type PortfolioCapacityRequest,
  type PortfolioValidatedBundleAuthority,
} from '../../src/portfolio/portfolio-journal.js';
import { createAssignmentExecutionEnvelope } from '../../src/workroom/assignment-executor.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import { capacityGrant, grantFact, route, sha } from '../portfolio/capacity-control-outbox.test.js';

describe('Workroom Portfolio Grant Assignment saga', () => {
  it('uses the Kernel issuer preview and consumes the exact Grant before Assignment claim', async () => {
    const item = await claimedItem();
    const claim = localClaim();
    const preview = portfolioGrantAssignmentIssuerPreview({
      kind: 'local', assignmentRef: 'kernel-assignment:1', claimDigest: digest(claim),
      taskRevision: 1, kernelSequence: 17, kernelStateDigest: sha('9'),
    });
    const binding = portfolioGrantAssignmentBinding({
      portfolioId: item.portfolioId, projectId: item.projectId,
      grantId: item.payload.grant.grantId, grantFence: item.payload.grant.fence,
      requestId: item.payload.grant.requestId, requestDigest: item.payload.grant.requestDigest,
      validatedBundleDigest: item.payload.grant.validatedBundleDigest,
      schedulerDecisionId: 'scheduler-decision:1', schedulerDecisionDigest: sha('b'),
      schedulerSequence: 9, opaqueHeadId: 'opaque-head:1', route: item.route,
      claim, issuerPreview: preview,
    });
    const order: string[] = [];
    const issued = claimedResult(preview.assignmentRef);
    const saga = new WorkroomPortfolioGrantAssignmentSaga({
      generation: 7,
      capacity: {
        consume: vi.fn(async () => { order.push('consume'); }),
        failAssignment: vi.fn(async () => { order.push('compensate'); }),
      },
      bindings: { resolve: async () => binding },
      issuances: {
        preview: async () => preview,
        issue: vi.fn(async () => { order.push('claim'); return issued; }),
        find: async () => issued,
      },
    });

    const ack = await saga.deliver(item, new AbortController().signal);

    expect(order).toEqual(['consume', 'claim']);
    expect(ack).toMatchObject({
      kind: 'grant_accepted', assignmentRef: preview.assignmentRef,
      grantFence: item.payload.grant.fence, deliveryFence: item.deliveryFence,
    });
    expect(await saga.authenticate(item, ack)).toBe(true);
  });

  it('refunds only a Kernel-proven deterministic rejection and emits a durable compensation receipt', async () => {
    const item = await claimedItem();
    const claim = localClaim();
    const preview = portfolioGrantAssignmentIssuerPreview({
      kind: 'local', assignmentRef: 'kernel-assignment:stale', claimDigest: digest(claim),
      taskRevision: 1, kernelSequence: 18, kernelStateDigest: sha('9'),
    });
    const binding = portfolioGrantAssignmentBinding({
      portfolioId: item.portfolioId, projectId: item.projectId,
      grantId: item.payload.grant.grantId, grantFence: item.payload.grant.fence,
      requestId: item.payload.grant.requestId, requestDigest: item.payload.grant.requestDigest,
      validatedBundleDigest: item.payload.grant.validatedBundleDigest,
      schedulerDecisionId: 'scheduler-decision:stale', schedulerDecisionDigest: sha('c'),
      schedulerSequence: 10, opaqueHeadId: 'opaque-head:stale', route: item.route,
      claim, issuerPreview: preview,
    });
    const failAssignment = vi.fn(async () => undefined);
    const rejected: PortfolioGrantAssignmentIssueResult = {
      kind: 'rejected', reason: 'task_stale', kernelSequence: 19,
      kernelFactDigest: sha('d'), proofDigest: sha('e'),
    };
    const saga = new WorkroomPortfolioGrantAssignmentSaga({
      generation: 7,
      capacity: { consume: async () => undefined, failAssignment },
      bindings: { resolve: async () => binding },
      issuances: { preview: async () => preview, issue: async () => rejected, find: async () => undefined },
    });

    const error = await saga.deliver(item, new AbortController().signal).catch(value => value);

    expect(error).toBeInstanceOf(PortfolioGrantAssignmentCompensatedError);
    expect(failAssignment).toHaveBeenCalledWith(expect.objectContaining({
      assignmentRef: preview.assignmentRef, reason: 'task_stale',
      kernelSequence: 19, kernelFactDigest: sha('d'),
    }));
    expect((error as PortfolioGrantAssignmentCompensatedError).compensation).toMatchObject({
      itemId: item.itemId, assignmentRef: preview.assignmentRef, reason: 'task_stale',
    });
  });

  it('does not release capacity when claim outcome is unknown', async () => {
    const item = await claimedItem();
    const claim = localClaim();
    const preview = portfolioGrantAssignmentIssuerPreview({
      kind: 'local', assignmentRef: 'kernel-assignment:unknown', claimDigest: digest(claim),
      taskRevision: 1, kernelSequence: 20, kernelStateDigest: sha('9'),
    });
    const binding = portfolioGrantAssignmentBinding({
      portfolioId: item.portfolioId, projectId: item.projectId,
      grantId: item.payload.grant.grantId, grantFence: item.payload.grant.fence,
      requestId: item.payload.grant.requestId, requestDigest: item.payload.grant.requestDigest,
      validatedBundleDigest: item.payload.grant.validatedBundleDigest,
      schedulerDecisionId: 'scheduler-decision:unknown', schedulerDecisionDigest: sha('f'),
      schedulerSequence: 11, opaqueHeadId: 'opaque-head:unknown', route: item.route,
      claim, issuerPreview: preview,
    });
    const failAssignment = vi.fn(async () => undefined);
    const saga = new WorkroomPortfolioGrantAssignmentSaga({
      generation: 7,
      capacity: { consume: async () => undefined, failAssignment },
      bindings: { resolve: async () => binding },
      issuances: {
        preview: async () => preview,
        issue: async () => { throw new Error('Kernel claim response lost'); },
        find: async () => undefined,
      },
    });

    await expect(saga.deliver(item, new AbortController().signal)).rejects.toThrow('response lost');
    expect(failAssignment).not.toHaveBeenCalled();
  });
});

describe('Portfolio Grant Assignment authority', () => {
  it('rejects a Grant when the exact local/remote route changed after the Capacity Request', async () => {
    const selected = schedulerDecision();
    const requestedRoute = {
      kind: 'local' as const, agentDefinitionId: 'agent:executor:1', authorityRef: 'local-route:7',
    };
    const changedRoute = {
      kind: 'remote' as const, agentDefinitionId: 'agent:executor:1', endpointId: 'remote-1',
      authorityRef: 'remote-route:7',
    };
    const repository = new InMemoryPortfolioJournalRepository();
    const application = new PortfolioAdmissionApplication({
      portfolioId: 'portfolio-main', repository,
      ids: { eventId: (type, identity) => `${type}:${identity}` },
    });
    const policy = createPortfolioPolicySnapshot({
      revision: 1, globalBudgetMicros: 100, offerTtlTicks: 5, leaseTtlTicks: 10,
      leaseHeartbeatTicks: 2, maxLeaseQuantumTicks: 20, maxLeaseRenewals: 2, reclaimTtlTicks: 4,
      pools: { model: { poolId: 'model', capacityUnits: 1, rateUnitsPerWindow: 10,
        rateWindowTicks: 10, priceMicrosPerBudgetUnit: 1 } },
      projects: { 'project-a': { projectId: 'project-a', revision: 1, lane: 'normal', weight: 1,
        hardBudgetMicros: 100, allowedPools: ['model'], maxOutstandingRequests: 2,
        maxConcurrentGrants: 1, burstLimit: 2, starvationTicks: 3, status: 'active' } },
    });
    await application.pinPolicy(policy, { principalId: 'sponsor:1', authorizedBy: 'root:1',
      reasonDigest: sha('1'), targetDigest: policy.digest, expectedRevision: 0 });
    const request = portfolioRequest(selected, requestedRoute);
    await application.submit(request, bundleAuthority(request));
    const grant = (await application.decideAdmission())!;
    const facts = await repository.read('portfolio-main');
    const grantFact = facts.find(fact => fact.type === 'capacity.grant_offered')!;
    if (grantFact.type !== 'capacity.grant_offered') throw new Error('test requires Grant fact');
    const routeAuthority = {
      catalogRevision: sha('c'), schedulerAuthorityRef: changedRoute.authorityRef,
      projectId: 'project-a', agentDefinitionId: changedRoute.agentDefinitionId,
      endpointId: changedRoute.endpointId,
    };
    const item = createPortfolioControlItem(grantFact, grant, {
      projectId: 'project-a',
      routeRef: `portfolio-assignment-route:${selected.decisionId}`,
      routeDigest: digest({ decisionDigest: selected.digest, routeAuthority }),
      authorityRef: changedRoute.authorityRef,
      authorityDigest: digest(routeAuthority),
    });
    const authority = new PortfolioGrantAssignmentAuthority({
      portfolioJournal: repository,
      workroomJournal: { read: async () => workroomEvents(selected) },
      catalog: { read: async () => ({ revision: sha('c'), definitions: { 'project-a': {
        enabled: true, members: [{ role: 'executor', agent: 'agent:executor:1' }],
      } } }) as never },
      schedulerRoute: { resolve: async () => changedRoute },
      issuances: { preview: async claim => portfolioGrantAssignmentIssuerPreview({
        kind: claim.kind, assignmentRef: 'assignment:remote:1', claimDigest: digest(claim),
        taskRevision: 1, kernelSequence: 2, kernelStateDigest: sha('2'),
      }) },
    });

    await expect(authority.resolve(item)).resolves.toBeUndefined();
  });
});

function localClaim(): PortfolioGrantAssignmentClaim {
  return { kind: 'local', request: {
    operationId: 'scheduler-dispatch:1', projectId: 'project-a', runId: 'run:project-a',
    taskKey: 'task-1', agentDefinitionId: 'agent:executor:1',
  } };
}

function schedulerDecision() {
  const body = {
    version: 1 as const, type: 'dispatch_task' as const, projectId: 'project-a', runId: 'run:project-a',
    expectedSequence: 1, taskKey: 'task-1', taskRevision: 1, role: 'executor',
    sponsorLane: 'normal' as const, reason: 'scheduler_order' as const,
    policy: { ref: 'scheduler:1', revision: 1, digest: sha('3') },
  };
  const decisionDigest = digest(body);
  return Object.freeze({ ...body, decisionId: `scheduler:${decisionDigest.slice(7)}`, digest: decisionDigest });
}

function workroomEvents(selected: ReturnType<typeof schedulerDecision>) {
  return [
    { version: 1, eventId: 'event:0', runId: selected.runId, sequence: 0,
      occurredAt: 0, type: 'run.created', payload: { projectId: selected.projectId, title: 'Run' } },
    { version: 1, eventId: 'event:1', runId: selected.runId, sequence: 1,
      occurredAt: 1, type: 'plan.admitted', payload: {} },
    { version: 1, eventId: 'event:2', runId: selected.runId, sequence: 2,
      occurredAt: 2, type: 'scheduler.dispatch_requested', payload: selected },
  ] as never;
}

function portfolioRequest(
  selected: ReturnType<typeof schedulerDecision>,
  route: Parameters<typeof workroomSchedulerPortfolioPayloadDigest>[1],
): PortfolioCapacityRequest {
  return {
    requestId: workroomSchedulerPortfolioRequestId(selected, route),
    projectId: selected.projectId,
    workRef: { runId: selected.runId, profileRevisionId: 'profile:1', profileDigest: sha('4') },
    schedulerRevision: selected.policy.digest, schedulerSequence: selected.expectedSequence + 1,
    localOrder: selected.expectedSequence + 1, projectPolicyRevision: 1,
    opaqueHeadId: workroomSchedulerPortfolioOpaqueHeadId(selected),
    payloadDigest: workroomSchedulerPortfolioPayloadDigest(selected, route),
    resourceBundle: { demands: [{ poolId: 'model', capacityUnits: 1, rateUnits: 1, budgetUnits: 5 }] },
    preemptibility: 'atomic', starvationAt: 3,
  };
}

function bundleAuthority(request: PortfolioCapacityRequest): PortfolioValidatedBundleAuthority {
  const claims = {
    requestDigest: portfolioCapacityRequestDigest(request),
    resourceBundleDigest: digest(request.resourceBundle),
    catalogGenerationId: 'catalog:7', catalogRevision: 1, catalogDigest: sha('5'),
    profileRevisionId: request.workRef.profileRevisionId,
    profileDigest: request.workRef.profileDigest, profileCeilingDigest: sha('6'),
    reservedCostMicros: 5,
  };
  return { ...claims, validatedBundleDigest: portfolioValidatedBundleDigest(claims) };
}

async function claimedItem() {
  const grant = capacityGrant();
  const fact = grantFact(grant);
  const item = createPortfolioControlItem(fact, grant, route(grant.projectId));
  const repository = new MemoryPortfolioControlOutboxRepository();
  await repository.append(item.portfolioId, -1, { type: 'source.scanned', payload: {
    sourceSequence: fact.sequence, sourceEventId: fact.eventId, sourceEventDigest: digest(fact), item,
  } });
  await repository.append(item.portfolioId, 0, { type: 'item.claimed', payload: {
    itemId: item.itemId, workerId: 'worker:1', deliveryFence: 1, claimedAt: 1, claimExpiresAt: 3,
  } });
  return replayPortfolioControlOutbox(item.portfolioId, await repository.read(item.portfolioId))
    .items[item.itemId]!;
}

function claimedResult(assignmentId: string) {
  const envelope = createAssignmentExecutionEnvelope({
    projectId: 'project-a', runId: 'run:project-a', taskKey: 'task-1', taskRevision: 1,
    assignmentId, assignmentRevision: 1, attempt: 1, fence: 1, principalId: 'agent:executor:1',
    role: 'executor',
    agentDefinition: snapshot('agent-definition:1'), plan: snapshot('plan:1'),
    contextPolicy: snapshot('context-policy:1'), capabilitySnapshot: snapshot('capability:1'),
    policySnapshot: snapshot('policy:1'), factAnchor: { ref: 'journal:17', sequence: 17, digest: sha('1') },
    workspace: { leaseRef: 'lease:1', mountRef: 'mount:1', baseRevision: 'base:1', fence: 1 },
  });
  return { kind: 'claimed' as const, issuedAt: 2, envelope };
}

function snapshot(ref: string) { return { ref, revision: 1, digest: sha('2') }; }
