import { describe, expect, it, vi } from 'vitest';
import type { AgentMessageRow } from '@zhin.js/ai';
import { createSessionTreeRuntimeFromAgent } from '../src/session-tree-runtime.js';
import type { ZhinAgentPrivate } from '../src/internal/agent-host.js';

function fixture(rows: AgentMessageRow[]) {
  const loadMessageRows = vi.fn(async () => rows);
  const host = { contextRepository: { loadMessageRows } } as unknown as ZhinAgentPrivate;
  return {runtime: createSessionTreeRuntimeFromAgent(host), loadMessageRows};
}

function row(id: number, sessionId: string, role: string, content: unknown[]): AgentMessageRow {
  return {id, session_id: sessionId, role, payload: JSON.stringify({role, content, timestamp: 1}), timestamp: 1};
}

describe('session tree message text', () => {
  it('returns the complete retained user text without image bytes or other payload fields', async () => {
    const text = '    indented first line\n\n' + '多行完整正文\n'.repeat(40);
    const tail = '\n\n    final block\n\n';
    const {runtime, loadMessageRows} = fixture([row(7, 'session-a', 'user', [
      {type: 'text', text}, {type: 'image', data: 'PRIVATE-IMAGE-BASE64', mimeType: 'image/png'},
      {type: 'text', text: tail},
    ])]);
    expect(await runtime.readBranchMessage!('session-a', 7)).toBe(`${text} ${tail}`);
    expect(loadMessageRows).toHaveBeenCalledWith('session-a');
    expect(await runtime.readBranchMessage!('session-a', 7)).not.toContain('PRIVATE-IMAGE-BASE64');
  });

  it('restricts reads to user rows of the requested session and preserves an empty text result', async () => {
    const {runtime} = fixture([
      row(1, 'session-a', 'assistant', [{type: 'text', text: 'assistant secret'}]),
      row(2, 'session-b', 'user', [{type: 'text', text: 'other session'}]),
      row(3, 'session-a', 'user', [{type: 'image', data: 'PRIVATE-IMAGE-BASE64'}]),
      {...row(4, 'session-a', 'user', []), payload: 'malformed json'},
    ]);
    expect(await runtime.readBranchMessage!('session-a', 1)).toBeNull();
    expect(await runtime.readBranchMessage!('session-a', 2)).toBeNull();
    expect(await runtime.readBranchMessage!('session-a', 3)).toBe('');
    expect(await runtime.readBranchMessage!('session-a', 4)).toBeNull();
    expect(await runtime.readBranchMessage!('session-a', 99)).toBeNull();
  });
});
