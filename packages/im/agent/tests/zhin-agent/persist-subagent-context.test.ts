import { describe, expect, it, vi } from 'vitest';
import { persistSubagentResultToContext } from '../../src/zhin-agent/persist-subagent-context.js';
import type { ZhinAgentPrivate } from '../../src/zhin-agent/zhin-agent-private.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

describe('persistSubagentResultToContext', () => {
  it('appends packaged subagent summary to active session', async () => {
    const appendMessages = vi.fn(async () => {});
    const agent = {
      agentSessionStore: {
        findActive: vi.fn(async () => ({ session_id: 'epoch-1' })),
      },
      contextRepository: { appendMessages },
    } as unknown as ZhinAgentPrivate;

    const ok = await persistSubagentResultToContext(
      agent,
      mockCommMessage({
        adapter: 'icqq',
        endpoint: '8596238',
        sceneId: '1659488338',
        senderId: '1659488338',
        scope: 'private',
      }),
      {
        taskId: 'abc12345',
        label: 'research',
        task: 'scan repo',
        origin: { message: mockCommMessage({ adapter: 'x', endpoint: 'b', sceneId: 's', senderId: 'u', scope: 'private' }) },
        status: 'ok',
        result: 'Found 12 modules',
        toolCalls: [],
      },
    );

    expect(ok).toBe(true);
    expect(appendMessages).toHaveBeenCalledWith('epoch-1', expect.any(Array));
    const batch = appendMessages.mock.calls[0]![1] as Array<{ role: string; content: Array<{ text?: string }> }>;
    expect(batch[0]?.role).toBe('assistant');
    expect(batch[0]?.content[0]?.text).toContain('Found 12 modules');
  });
});
