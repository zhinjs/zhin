import { rootPluginId, Scope } from '@zhin.js/plugin-runtime';
import {
  installWorkroomPortfolioControlWorker,
  portfolioControlWorkerToken,
} from '../../src/plugin-runtime/workroom-portfolio-control-composition.js';
import { MemoryPortfolioControlOutboxRepository } from '../../src/portfolio/capacity-control-outbox.js';
import { vi } from 'vitest';

describe('standard Portfolio Control worker composition', () => {
  it('installs one generation-owned worker and stops cleanly with its Root signal', async () => {
    const resources = new Scope(rootPluginId());
    const controller = new AbortController();
    const unavailable = {
      deliver: async () => { throw new Error('not used'); },
      reconcile: async () => { throw new Error('not used'); },
      authenticate: async () => false,
    };
    const worker = installWorkroomPortfolioControlWorker({
      generation: 7, signal: controller.signal, resources,
      journal: { listPortfolioIds: async () => [], read: async () => [] },
      outbox: new MemoryPortfolioControlOutboxRepository(),
      capacity: {
        consume: async () => { throw new Error('not used'); },
        acknowledgeReclaim: async () => { throw new Error('not used'); },
      },
      route: { resolve: async () => undefined },
      grantAssignments: unavailable,
      checkpointAcks: unavailable,
      intervalMs: 10_000,
    });

    expect(resources.use(portfolioControlWorkerToken)).toBe(worker);
    expect(installWorkroomPortfolioControlWorker({
      generation: 7, signal: controller.signal, resources,
      journal: { listPortfolioIds: async () => [], read: async () => [] },
      outbox: new MemoryPortfolioControlOutboxRepository(),
      capacity: { consume: async () => undefined, acknowledgeReclaim: async () => undefined },
      route: { resolve: async () => undefined }, grantAssignments: unavailable,
      checkpointAcks: unavailable,
    })).toBe(worker);
    await expect(worker.drain()).resolves.toBe(0);
    controller.abort();
    await expect(worker.dispose()).resolves.toBeUndefined();
    await expect(worker.drain()).resolves.toBe(0);
  });

  it('defers all Journal reads until generation handoff when autoStart is false', async () => {
    const resources = new Scope(rootPluginId());
    const listPortfolioIds = vi.fn(async () => [] as string[]);
    const unavailable = { deliver: async () => { throw new Error('not used'); },
      reconcile: async () => { throw new Error('not used'); }, authenticate: async () => false };
    const worker = installWorkroomPortfolioControlWorker({
      generation: 8, signal: new AbortController().signal, resources, autoStart: false,
      journal: { listPortfolioIds, read: async () => [] },
      outbox: new MemoryPortfolioControlOutboxRepository(),
      capacity: { consume: async () => undefined, acknowledgeReclaim: async () => undefined },
      route: { resolve: async () => undefined }, grantAssignments: unavailable,
      checkpointAcks: unavailable,
    });
    await Promise.resolve();
    expect(listPortfolioIds).not.toHaveBeenCalled();
    worker.start();
    await expect(worker.drain()).resolves.toBe(0);
    expect(listPortfolioIds).toHaveBeenCalled();
    await worker.dispose();
  });
});
