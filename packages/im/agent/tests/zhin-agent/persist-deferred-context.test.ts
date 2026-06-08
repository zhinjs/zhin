import { describe, expect, it, vi } from 'vitest';
import { persistDeferredWorkerResultToContext } from '../../src/zhin-agent/persist-deferred-context.js';
import type { ZhinAgentPrivate } from '../../src/zhin-agent/zhin-agent-private.js';

describe('persistDeferredWorkerResultToContext', () => {
  it('appends packaged worker summary to active session', async () => {
    const appendMessages = vi.fn(async () => {});
    const agent = {
      agentSessionStore: {
        findActive: vi.fn(async () => ({ session_id: 'epoch-1' })),
      },
      contextRepository: { appendMessages },
    } as unknown as ZhinAgentPrivate;

    const ok = await persistDeferredWorkerResultToContext(
      agent,
      {
        platform: 'icqq',
        botId: '8596238',
        sceneId: '1659488338',
        senderId: '1659488338',
        scope: 'private',
      },
      'abc12345',
      'read skill.md',
      {
        summary: JSON.stringify({ status: 'ok', summary: 'Clawvard exam skill body' }),
        loadedToolNames: ['web_fetch'],
        iterations: 2,
        status: 'ok',
      },
    );

    expect(ok).toBe(true);
    expect(appendMessages).toHaveBeenCalledWith('epoch-1', expect.any(Array));
    const batch = appendMessages.mock.calls[0]![1] as Array<{ role: string }>;
    expect(batch[0]?.role).toBe('assistant');
  });

  it('returns false when no active session', async () => {
    const agent = {
      agentSessionStore: { findActive: vi.fn(async () => null) },
      contextRepository: { appendMessages: vi.fn() },
    } as unknown as ZhinAgentPrivate;

    const ok = await persistDeferredWorkerResultToContext(
      agent,
      { platform: 'x', botId: 'b', sceneId: 's', senderId: 'u', scope: 'private' },
      't1',
      'goal',
      { summary: '{"summary":"x"}', loadedToolNames: [], iterations: 0, status: 'ok' },
    );
    expect(ok).toBe(false);
  });
});
