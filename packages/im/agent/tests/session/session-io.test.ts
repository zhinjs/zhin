import { describe, expect, it, vi } from 'vitest';
import { archiveSessionByKey } from '../../src/session/session-io.js';

describe('Agent session lifecycle authority', () => {
  it('archives a session exactly once through ContextRepository authority', async () => {
    const archiveSession = vi.fn(async () => true);
    const archiveByKey = vi.fn(async () => false);

    await expect(archiveSessionByKey({
      contextRepository: { archiveSession } as never,
      agentSessionStore: { archiveByKey } as never,
    }, 'http:session-1')).resolves.toBe(true);

    expect(archiveSession).toHaveBeenCalledOnce();
    expect(archiveByKey).not.toHaveBeenCalled();
  });
});
