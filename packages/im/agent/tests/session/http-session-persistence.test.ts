import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import { FileHttpSessionPersistence } from '../../src/session/http-session-persistence.js';

describe('FileHttpSessionPersistence', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('saves and loads session snapshot', async () => {
    dir = await mkdtemp(join(tmpdir(), 'zhin-http-sess-'));
    const persistence = new FileHttpSessionPersistence(dir);
    const snapshot = {
      sessionId: 'ses_test123',
      continuationToken: 'zhin:tok',
      status: 'waiting' as const,
      events: [{ type: 'session.started', data: { sessionId: 'ses_test123' } }],
      steps: [],
      parked: false,
      pendingRequestIds: [],
      turnRunning: false,
      updatedAt: Date.now(),
    };
    await persistence.save(snapshot);
    const loaded = await persistence.load('ses_test123');
    expect(loaded?.sessionId).toBe('ses_test123');
    expect(loaded?.continuationToken).toBe('zhin:tok');
    expect(loaded?.events).toHaveLength(1);
    const ids = await persistence.listSessionIds();
    expect(ids).toContain('ses_test123');
  });
});
