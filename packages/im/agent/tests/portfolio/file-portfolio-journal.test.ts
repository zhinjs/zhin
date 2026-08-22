import { mkdtemp, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilePortfolioJournalRepository } from '../../src/portfolio/file-portfolio-journal.js';
import {
  InMemoryPortfolioJournalRepository,
  PortfolioSequenceConflictError,
  type PortfolioFactDraft,
  type PortfolioJournalRepository,
} from '../../src/portfolio/portfolio-journal.js';

describe.each([
  ['memory', async () => new InMemoryPortfolioJournalRepository()],
] as const)('%s Portfolio Journal enumeration', (_name, create) => {
  it('enumerates only portfolios with durable facts', async () => {
    const repository: PortfolioJournalRepository = await create();
    await repository.append('portfolio-b', -1, [requestFact('event-b', 'request-b', 'head-b')]);
    await repository.append('portfolio-a', -1, [requestFact('event-a', 'request-a', 'head-a')]);
    expect(await repository.listPortfolioIds()).toEqual(['portfolio-a', 'portfolio-b']);
  });
});

describe('FilePortfolioJournalRepository', () => {
  it('replays durable facts and enumerates Portfolio ids after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-portfolio-file-'));
    const directory = join(root, 'journal');
    await mkdir(directory);
    try {
      const first = new FilePortfolioJournalRepository(directory);
      await first.append('portfolio-main', -1, [requestFact('event-1')]);

      const restarted = new FilePortfolioJournalRepository(directory);
      expect(await restarted.listPortfolioIds()).toEqual(['portfolio-main']);
      expect(await restarted.read('portfolio-main')).toMatchObject([
        { portfolioId: 'portfolio-main', sequence: 0, eventId: 'event-1' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses create-only CAS across repository instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-portfolio-cas-'));
    const directory = join(root, 'journal');
    await mkdir(directory);
    try {
      const left = new FilePortfolioJournalRepository(directory);
      const right = new FilePortfolioJournalRepository(directory);
      await left.append('portfolio-main', -1, [requestFact('event-1')]);
      const settled = await Promise.allSettled([
        left.append('portfolio-main', 0, [requestFact('event-left', 'request-left', 'head-left')]),
        right.append('portfolio-main', 0, [requestFact('event-right', 'request-right', 'head-right')]),
      ]);

      expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(settled.find(result => result.status === 'rejected')).toMatchObject({
        reason: expect.any(PortfolioSequenceConflictError),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when a segment filename no longer matches its first sequence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-portfolio-corrupt-'));
    const directory = join(root, 'journal');
    await mkdir(directory);
    try {
      const repository = new FilePortfolioJournalRepository(directory);
      await repository.append('portfolio-main', -1, [requestFact('event-1')]);
      const [name] = (await readdir(directory)).filter(value => value.endsWith('.json'));
      const corrupted = name!.replace('.0000000000000000.json', '.0000000000000001.json');
      await rename(join(directory, name!), join(directory, corrupted));

      await expect(new FilePortfolioJournalRepository(directory).read('portfolio-main'))
        .rejects.toThrow('first sequence');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function requestFact(
  eventId: string,
  requestId = 'capacity-request-1',
  opaqueHeadId = 'head-1',
): PortfolioFactDraft {
  return Object.freeze({
    eventId,
    occurredAt: 1_000,
    type: 'capacity.requested' as const,
    payload: Object.freeze({
      request: Object.freeze({
        requestId,
        projectId: 'project-a',
        workRef: Object.freeze({
          runId: 'run-1',
          profileRevisionId: 'profile-1',
          profileDigest: 'sha256:profile-1',
        }),
        schedulerRevision: 'scheduler-1',
        schedulerSequence: 1,
        localOrder: 1,
        projectPolicyRevision: 1,
        opaqueHeadId,
        payloadDigest: `sha256:${requestId}`,
        resourceBundle: Object.freeze({
          demands: Object.freeze([
            Object.freeze({ poolId: 'model', capacityUnits: 1, rateUnits: 1, budgetUnits: 1 }),
          ]),
        }),
        preemptibility: 'atomic' as const,
        starvationAt: 2_000,
      }),
    }),
  });
}
