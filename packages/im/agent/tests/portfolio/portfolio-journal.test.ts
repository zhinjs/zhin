import {
  InMemoryPortfolioJournalRepository,
  PortfolioEventIdentityConflictError,
  PortfolioRequestIdentityConflictError,
  PortfolioSequenceConflictError,
  createPortfolioPolicySnapshot,
  parsePortfolioCapacityRequest,
  type PortfolioCapacityRequest,
  type PortfolioFactDraft,
} from '../../src/portfolio/portfolio-journal.js';

describe('Portfolio lease policy snapshot', () => {
  it('pins heartbeat, renewal and max-quantum limits into the policy digest', () => {
    const input = {
      revision: 1, globalBudgetMicros: 100, offerTtlTicks: 2, leaseTtlTicks: 5,
      leaseHeartbeatTicks: 1, maxLeaseQuantumTicks: 7, maxLeaseRenewals: 2,
      reclaimTtlTicks: 2,
      pools: { model: { poolId: 'model', capacityUnits: 1, rateUnitsPerWindow: 10,
        rateWindowTicks: 10, priceMicrosPerBudgetUnit: 1 } },
      projects: { project: { projectId: 'project', revision: 1, lane: 'normal', weight: 1,
        hardBudgetMicros: 100, allowedPools: ['model'], maxOutstandingRequests: 2,
        maxConcurrentGrants: 1, burstLimit: 1, starvationTicks: 2, status: 'active' } },
    } as const;
    const policy = createPortfolioPolicySnapshot(input);
    expect(policy).toMatchObject({
      leaseHeartbeatTicks: 1, maxLeaseQuantumTicks: 7, maxLeaseRenewals: 2,
    });
    expect(() => createPortfolioPolicySnapshot({ ...input, maxLeaseQuantumTicks: 4 }))
      .toThrow('quantum');
  });
});

function capacityRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'capacity-request-1',
    projectId: 'project-a',
    workRef: {
      runId: 'run-7',
      profileRevisionId: 'profile-revision-3',
      profileDigest: 'sha256:profile-v3',
    },
    schedulerRevision: 'scheduler-revision-5',
    schedulerSequence: 19,
    localOrder: 4,
    projectPolicyRevision: 8,
    opaqueHeadId: 'head-19',
    payloadDigest: 'sha256:opaque-work-payload',
    resourceBundle: {
      demands: [
        { poolId: 'executor:local', capacityUnits: 1, rateUnits: 2, budgetUnits: 0 },
        { poolId: 'model:reasoning', capacityUnits: 1, rateUnits: 5000, budgetUnits: 7500 },
      ],
    },
    preemptibility: 'checkpointable',
    deadlineAt: 2000,
    starvationAt: 1500,
    ...overrides,
  };
}

function requestFact(
  eventId: string,
  request: Record<string, unknown> = capacityRequest(),
): PortfolioFactDraft {
  return {
    eventId,
    occurredAt: 1000,
    type: 'capacity.requested',
    payload: { request },
  };
}

describe('parsePortfolioCapacityRequest', () => {
  it('returns only a deterministic frozen opaque scheduling request', () => {
    const parsed = parsePortfolioCapacityRequest(capacityRequest()) as PortfolioCapacityRequest;
    const reversed = parsePortfolioCapacityRequest(capacityRequest({
      resourceBundle: {
        demands: [...(capacityRequest().resourceBundle as { demands: unknown[] }).demands].reverse(),
      },
    }));

    expect(parsed).toEqual(reversed);
    expect(parsed).toEqual({
      requestId: 'capacity-request-1',
      projectId: 'project-a',
      workRef: {
        runId: 'run-7',
        profileRevisionId: 'profile-revision-3',
        profileDigest: 'sha256:profile-v3',
      },
      schedulerRevision: 'scheduler-revision-5',
      schedulerSequence: 19,
      localOrder: 4,
      projectPolicyRevision: 8,
      opaqueHeadId: 'head-19',
      payloadDigest: 'sha256:opaque-work-payload',
      resourceBundle: {
        demands: [
          { poolId: 'executor:local', capacityUnits: 1, rateUnits: 2, budgetUnits: 0 },
          { poolId: 'model:reasoning', capacityUnits: 1, rateUnits: 5000, budgetUnits: 7500 },
        ],
      },
      preemptibility: 'checkpointable',
      deadlineAt: 2000,
      starvationAt: 1500,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.workRef)).toBe(true);
    expect(Object.isFrozen(parsed.resourceBundle.demands)).toBe(true);
    expect(Object.isFrozen(parsed.resourceBundle.demands[0])).toBe(true);
  });

  it.each([
    'task',
    'plan',
    'context',
    'memory',
    'artifact',
    'evidence',
    'prompt',
    'message',
    'title',
    'toolArgs',
  ])('rejects forbidden Workroom field %s', (field) => {
    expect(() => parsePortfolioCapacityRequest(capacityRequest({ [field]: 'forbidden body' })))
      .toThrow(field);
  });

  it('rejects unknown fields nested inside opaque refs and Resource Bundle demands', () => {
    const request = capacityRequest();
    expect(() => parsePortfolioCapacityRequest(capacityRequest({
      workRef: { ...(request.workRef as object), context: 'hidden context' },
    }))).toThrow('context');
    expect(() => parsePortfolioCapacityRequest(capacityRequest({
      resourceBundle: {
        demands: [{
          poolId: 'model:reasoning',
          capacityUnits: 1,
          rateUnits: 1,
          budgetUnits: 1,
          toolArgs: { secret: true },
        }],
      },
    }))).toThrow('toolArgs');
  });
});

describe('InMemoryPortfolioJournalRepository', () => {
  it('appends content-free Portfolio facts with expectedSequence CAS', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    const [created] = await repository.append('portfolio-main', -1, [requestFact('event-1')]);

    expect(created).toMatchObject({
      version: 1,
      portfolioId: 'portfolio-main',
      sequence: 0,
      eventId: 'event-1',
      type: 'capacity.requested',
    });
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created?.payload.request)).toBe(true);
    await expect(repository.append('portfolio-main', -1, [requestFact('event-2', capacityRequest({
      requestId: 'capacity-request-2',
      opaqueHeadId: 'head-20',
    }))])).rejects.toEqual(new PortfolioSequenceConflictError('portfolio-main', -1, 0));
    expect(await repository.read('portfolio-main')).toHaveLength(1);
  });

  it('makes eventId replay payload-sensitive', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    const first = await repository.append('portfolio-main', -1, [requestFact('event-1')]);
    const replay = await repository.append('portfolio-main', -1, [requestFact('event-1')]);

    expect(replay).toEqual(first);
    expect(await repository.read('portfolio-main')).toHaveLength(1);
    await expect(repository.append('portfolio-main', -1, [requestFact('event-1', capacityRequest({
      payloadDigest: 'sha256:changed-payload',
    }))])).rejects.toBeInstanceOf(PortfolioEventIdentityConflictError);
  });

  it('rejects requestId and opaqueHeadId content drift even under a new eventId', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    await repository.append('portfolio-main', -1, [requestFact('event-1')]);

    await expect(repository.append('portfolio-main', 0, [requestFact('event-2', capacityRequest({
      payloadDigest: 'sha256:changed-payload',
    }))])).rejects.toBeInstanceOf(PortfolioRequestIdentityConflictError);
    await expect(repository.append('portfolio-main', 0, [requestFact('event-3', capacityRequest({
      requestId: 'capacity-request-elsewhere',
      payloadDigest: 'sha256:other-work',
    }))])).rejects.toBeInstanceOf(PortfolioRequestIdentityConflictError);
    expect(await repository.read('portfolio-main')).toHaveLength(1);
  });

  it('requires an unchanged request replay to keep its original eventId', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    await repository.append('portfolio-main', -1, [requestFact('event-1')]);

    await expect(repository.append('portfolio-main', 0, [requestFact('event-2')]))
      .rejects.toBeInstanceOf(PortfolioRequestIdentityConflictError);
    expect(await repository.read('portfolio-main')).toHaveLength(1);
  });

  it('checks expectedSequence even when the append batch is empty', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    await repository.append('portfolio-main', -1, [requestFact('event-1')]);

    await expect(repository.append('portfolio-main', -1, []))
      .rejects.toEqual(new PortfolioSequenceConflictError('portfolio-main', -1, 0));
    await expect(repository.append('portfolio-main', 0, [])).resolves.toEqual([]);
  });

  it('allows only one concurrent writer at the same expectedSequence', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    await repository.append('portfolio-main', -1, [requestFact('event-1')]);
    const results = await Promise.allSettled([
      repository.append('portfolio-main', 0, [requestFact('event-left', capacityRequest({
        requestId: 'capacity-request-left',
        opaqueHeadId: 'head-left',
      }))]),
      repository.append('portfolio-main', 0, [requestFact('event-right', capacityRequest({
        requestId: 'capacity-request-right',
        opaqueHeadId: 'head-right',
      }))]),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.any(PortfolioSequenceConflictError),
    });
    expect(await repository.read('portfolio-main')).toHaveLength(2);
  });

  it('does not append duplicate identities twice inside one batch', async () => {
    const repository = new InMemoryPortfolioJournalRepository();
    const appended = await repository.append('portfolio-main', -1, [
      requestFact('event-1'),
      requestFact('event-1'),
    ]);

    expect(appended).toHaveLength(1);
    expect(await repository.read('portfolio-main')).toHaveLength(1);
  });
});
