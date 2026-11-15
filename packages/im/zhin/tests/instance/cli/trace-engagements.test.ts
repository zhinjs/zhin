import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openProjectEngagementJournal } from '../../../src/instance/cli/trace.js';

describe('zhin trace --engagements (#1250 trace-engagements-crash)', () => {
  it('opens the project journal over the database models and lists, reads and summarizes engagements', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-trace-engagements-'));
    try {
      const opened = await openProjectEngagementJournal(root);
      expect(opened).not.toBeNull();
      try {
        // Empty before any collaboration: no `this[#db].select is not a function`.
        await expect(opened!.journal.listEngagements(50)).resolves.toEqual([]);
        await opened!.journal.append({ engagementId: 'eng-1', type: 'engagement_opened', at: 1_000,
          data: { initiator: { kind: 'human', id: 'alice', trust: 'master' }, entry: 'zhin' } });
        await opened!.journal.append({ engagementId: 'eng-1', type: 'mail_sent', at: 1_100,
          data: { mailId: 'm1', kind: 'delegate', from: 'zhin', to: 'planner' } });
        await expect(opened!.journal.listEngagements(50)).resolves.toEqual(['eng-1']);
        const events = await opened!.journal.read('eng-1');
        expect(events.map(event => event.type)).toEqual(['engagement_opened', 'mail_sent']);
        const summary = await opened!.journal.summarize('eng-1');
        expect(summary?.engagementId).toBe('eng-1');
        expect(summary?.mailCount).toBe(1);
      } finally {
        await opened!.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
