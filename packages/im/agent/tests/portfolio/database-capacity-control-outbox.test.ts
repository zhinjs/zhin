import {
  ActivatablePortfolioControlOutboxRepository,
  DatabasePortfolioControlOutboxRepository,
  PORTFOLIO_CONTROL_OUTBOX_MODEL,
  definePortfolioControlOutboxDatabaseModel,
  type PortfolioControlOutboxDatabase,
  type PortfolioControlOutboxDatabaseModel,
} from '../../src/portfolio/database-capacity-control-outbox.js';
import {
  MemoryPortfolioControlOutboxRepository,
  createPortfolioControlItem,
  replayPortfolioControlOutbox,
  type PortfolioControlOutboxEventDraft,
  type PortfolioControlCompensation,
} from '../../src/portfolio/capacity-control-outbox.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import type { PortfolioCapacityGrant, PortfolioFact } from '../../src/portfolio/portfolio-journal.js';

describe('Database Portfolio Capacity control outbox', () => {
  it('does not expose a writer until the durable target replays successfully', async () => {
    const activatable = new ActivatablePortfolioControlOutboxRepository();
    expect(() => activatable.read('portfolio-main')).toThrow('not active');
    const broken = {
      read: vi.fn(async () => { throw new Error('database replay drift'); }),
      append: vi.fn(),
    };

    await expect(activatable.activate(broken, ['portfolio-main']))
      .rejects.toThrow('database replay drift');
    expect(() => activatable.read('portfolio-main')).toThrow('not active');

    const durable = new MemoryPortfolioControlOutboxRepository();
    await activatable.activate(durable, ['portfolio-main']);
    await expect(activatable.read('portfolio-main')).resolves.toEqual([]);
  });

  it('copies and verifies a durable File source before publishing the Database writer', async () => {
    const source = new MemoryPortfolioControlOutboxRepository();
    await source.append('portfolio-main', -1, {
      type: 'source.scanned', payload: {
        sourceSequence: 0, sourceEventId: 'source:0', sourceEventDigest: sha('e'),
      },
    });
    const target = new MemoryPortfolioControlOutboxRepository();
    const activatable = new ActivatablePortfolioControlOutboxRepository();
    await activatable.activate(target, ['portfolio-main'], source);
    expect(await activatable.read('portfolio-main')).toEqual(await source.read('portfolio-main'));
  });

  it('recovers cursor and outcome_unknown through the injected SERIALIZABLE database contract', async () => {
    const fixture = databaseFixture();
    const first = new DatabasePortfolioControlOutboxRepository(fixture.database, fixture.model);
    const grant = capacityGrant();
    const fact = grantFact(grant);
    const item = createPortfolioControlItem(fact, grant, route('project-a'));
    await append(first, {
      type: 'source.scanned', payload: {
        sourceSequence: 0, sourceEventId: fact.eventId, sourceEventDigest: digest(fact), item,
      },
    });
    await append(first, { type: 'item.claimed', payload: {
      itemId: item.itemId, workerId: 'worker:1', deliveryFence: 1, claimedAt: 1, claimExpiresAt: 2,
    } });
    await append(first, { type: 'item.outcome_unknown', payload: {
      itemId: item.itemId, deliveryFence: 1, observedAt: 2,
    } });

    const restarted = new DatabasePortfolioControlOutboxRepository(fixture.database, fixture.model);
    expect(replayPortfolioControlOutbox('portfolio-main', await restarted.read('portfolio-main')))
      .toMatchObject({ sourceCursor: 0, sequence: 2, items: { [item.itemId]: {
        status: 'outcome_unknown', deliveryFence: 1,
      } } });
    expect(fixture.isolationLevels).toEqual(['SERIALIZABLE', 'SERIALIZABLE', 'SERIALIZABLE']);
  });

  it('recovers and CAS-normalizes one compensation after an unknown delivery response', async () => {
    const fixture = databaseFixture();
    const first = new DatabasePortfolioControlOutboxRepository(fixture.database, fixture.model);
    const grant = capacityGrant();
    const fact = grantFact(grant);
    const item = createPortfolioControlItem(fact, grant, route(grant.projectId));
    await append(first, { type: 'source.scanned', payload: {
      sourceSequence: 0, sourceEventId: fact.eventId, sourceEventDigest: digest(fact), item,
    } });
    await append(first, { type: 'item.claimed', payload: {
      itemId: item.itemId, workerId: 'worker:1', deliveryFence: 1, claimedAt: 1, claimExpiresAt: 3,
    } });
    await append(first, { type: 'item.outcome_unknown', payload: {
      itemId: item.itemId, deliveryFence: 1, observedAt: 2,
    } });
    const compensation = compensated(item.itemId);
    const draft = { type: 'item.compensated' as const, payload: {
      itemId: item.itemId, deliveryFence: 1, compensation,
    } };
    const restarted = new DatabasePortfolioControlOutboxRepository(fixture.database, fixture.model);
    const [left, right] = await Promise.all([
      restarted.append('portfolio-main', 2, draft),
      restarted.append('portfolio-main', 2, draft),
    ]);

    expect(left).toEqual(right);
    expect(replayPortfolioControlOutbox('portfolio-main', await restarted.read('portfolio-main')))
      .toMatchObject({ sequence: 3, items: { [item.itemId]: {
        status: 'closed', compensation,
      } } });
  });

  it('rereads a concurrent database winner and rejects a different event at the same CAS slot', async () => {
    const fixture = databaseFixture();
    const repository = new DatabasePortfolioControlOutboxRepository(fixture.database, fixture.model);
    const winner = { type: 'source.scanned' as const, payload: {
      sourceSequence: 0, sourceEventId: 'winner', sourceEventDigest: sha('b'),
    } };
    fixture.winNextInsertWith(winner);

    await expect(repository.append('portfolio-main', -1, {
      type: 'source.scanned', payload: {
        sourceSequence: 0, sourceEventId: 'loser', sourceEventDigest: sha('c'),
      },
    })).rejects.toThrow('sequence conflict');
    expect(replayPortfolioControlOutbox('portfolio-main', await repository.read('portfolio-main')))
      .toMatchObject({ sourceCursor: 0, sequence: 0 });
    expect((await repository.read('portfolio-main'))[0]?.payload).toMatchObject({ sourceEventId: 'winner' });
  });

  it('normalizes an exact concurrent duplicate only after rereading the durable winner', async () => {
    const fixture = databaseFixture();
    const repository = new DatabasePortfolioControlOutboxRepository(fixture.database, fixture.model);
    const draft = { type: 'source.scanned' as const, payload: {
      sourceSequence: 0, sourceEventId: 'same', sourceEventDigest: sha('d'),
    } };
    fixture.winNextInsertWith(draft);

    await expect(repository.append('portfolio-main', -1, draft)).resolves.toMatchObject({
      sequence: 0, payload: { sourceEventId: 'same' },
    });
    expect(await repository.read('portfolio-main')).toHaveLength(1);
  });

  it('registers its real database schema through a composition-safe definition helper', () => {
    const define = vi.fn();
    definePortfolioControlOutboxDatabaseModel({ define });
    expect(define).toHaveBeenCalledWith('portfolio_control_outbox', PORTFOLIO_CONTROL_OUTBOX_MODEL);
  });
});

async function append(
  repository: DatabasePortfolioControlOutboxRepository,
  draft: PortfolioControlOutboxEventDraft,
) {
  const state = replayPortfolioControlOutbox('portfolio-main', await repository.read('portfolio-main'));
  return await repository.append('portfolio-main', state.sequence, draft);
}

function databaseFixture() {
  const rows: Record<string, unknown>[] = [];
  const isolationLevels: string[] = [];
  let winner: PortfolioControlOutboxEventDraft | undefined;
  const select = (query: Record<string, unknown>) => rows.filter(row =>
    Object.entries(query).every(([key, value]) => row[key] === value));
  const model: PortfolioControlOutboxDatabaseModel = {
    select: () => ({ where: async query => select(query) }),
  };
  const database: PortfolioControlOutboxDatabase = {
    transaction: async (operation, options) => {
      isolationLevels.push(options.isolationLevel);
      return await operation({
        select: () => ({ where: async query => select(query) }),
        insertMany: async (_table, inserted) => {
          if (winner) {
            const draft = winner;
            winner = undefined;
            const event = await materializeWinner(draft);
            rows.push(event);
            throw Object.assign(new Error('unique constraint loser'), { code: '23505' });
          }
          if (inserted.some(candidate => rows.some(row => row.id === candidate.id))) {
            throw Object.assign(new Error('unique constraint loser'), { code: '23505' });
          }
          rows.push(...inserted);
        },
      });
    },
  };
  return {
    database, model, isolationLevels,
    winNextInsertWith: (draft: PortfolioControlOutboxEventDraft) => { winner = draft; },
  };
}

async function materializeWinner(draft: PortfolioControlOutboxEventDraft): Promise<Record<string, unknown>> {
  const fixture = databaseFixture();
  const repository = new DatabasePortfolioControlOutboxRepository(fixture.database, fixture.model);
  await repository.append('portfolio-main', -1, draft);
  return fixture.model.select().where({ portfolio_id: 'portfolio-main' }).then(rows => rows[0]!);
}

function capacityGrant(): PortfolioCapacityGrant {
  return {
    grantId: 'grant-1', requestId: 'request-1', projectId: 'project-a', fence: 4,
    resourceBundle: { demands: [{ poolId: 'model', capacityUnits: 1, rateUnits: 1, budgetUnits: 1 }] },
    requestDigest: sha('1'), resourceBundleDigest: sha('2'), catalogGenerationId: 'catalog-generation:1',
    catalogRevision: 1, catalogDigest: sha('3'), profileRevisionId: 'profile:1', profileDigest: sha('4'),
    profileCeilingDigest: sha('5'), validatedBundleDigest: sha('6'), reservedCostMicros: 10,
    portfolioPolicyRevision: 1, portfolioPolicyDigest: sha('7'), projectPolicyRevision: 1,
    lane: 'normal', issuedAt: 1, issuedSequence: 0, offerExpiresAt: 3, status: 'offered',
  };
}

function grantFact(grant: PortfolioCapacityGrant): Extract<PortfolioFact, { type: 'capacity.grant_offered' }> {
  return {
    version: 1, portfolioId: 'portfolio-main', sequence: 0,
    eventId: 'capacity.grant_offered:grant-1', occurredAt: 1,
    type: 'capacity.grant_offered', payload: { grant },
  };
}

function route(projectId: string) {
  return {
    projectId, routeRef: 'workroom-route:1', routeDigest: sha('8'),
    authorityRef: 'catalog:1', authorityDigest: sha('9'),
  };
}

function sha(char: string): string { return `sha256:${char.repeat(64)}`; }

function compensated(itemId: string): PortfolioControlCompensation {
  const body = { version: 1 as const, itemId, portfolioId: 'portfolio-main', projectId: 'project-a',
    grantId: 'grant-1', grantFence: 4, deliveryFence: 1, assignmentRef: 'assignment:stale',
    reason: 'task_stale' as const, kernelSequence: 17, kernelFactDigest: sha('a'), proofDigest: sha('b') };
  return { ...body, digest: digest(body) };
}
