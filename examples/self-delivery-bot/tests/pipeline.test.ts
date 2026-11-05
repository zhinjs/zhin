import { describe, expect, it } from 'vitest';
import { runSelfDeliveryPipeline, SelfDeliveryProject } from '../src/pipeline.js';

describe('self-delivery pipeline (@zhin.js/harness)', () => {
  it('orchestrates planner -> builder -> reviewer via Harness ask and blackboard entries', async () => {
    const result = await runSelfDeliveryPipeline({
      identity: 'maintainer-1',
      issueNumber: 48,
      acceptanceCriteria: [
        'Use @zhin.js/harness createHarness and InMemoryEngagementJournal',
        'Record plan, draft, and review on the engagement blackboard',
      ],
    });

    expect(result.issueNumber).toBe(48);
    expect(result.status).toBe('approved');
    expect(result.reply).toContain('APPROVED: Issue #48 satisfies 2 acceptance criteria');

    const keys = result.board.map((entry) => entry.key);
    expect(keys).toEqual(expect.arrayContaining(['plan', 'draft', 'review', 'todo:implement']));

    const todo = result.board.find((entry) => entry.key === 'todo:implement');
    expect(todo?.status).toBe('done');
    expect(todo?.version).toBe(2);

    expect(result.summary.status).toBe('completed');
    expect(result.summary.actors).toEqual(expect.arrayContaining(['planner', 'builder', 'reviewer']));
    expect(result.summary.hops.length).toBeGreaterThanOrEqual(3);
  });

  it('fails closed in SelfDeliveryProject when unconfigured and runs pipeline when configured', async () => {
    const unconfigured = new SelfDeliveryProject('/non-existent-self-delivery-dir', { configured: false });
    expect(await unconfigured.doctor()).toMatchObject({ configured: false, ready: false });
    await expect(
      unconfigured.select({ identity: 'alice', issueNumber: 1, acceptanceCriteria: ['ship'] }),
    ).rejects.toThrow('not configured');

    const configured = new SelfDeliveryProject('/tmp/self-delivery', { configured: true });
    expect(await configured.doctor()).toMatchObject({ configured: true, ready: true });
    const delivery = await configured.select({
      identity: 'alice',
      issueNumber: 7,
      acceptanceCriteria: ['pass harness tests'],
    });
    expect(delivery.status).toBe('approved');
  });
});
