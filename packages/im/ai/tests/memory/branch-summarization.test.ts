import { describe, it, expect } from 'vitest';
import { createUserMessage } from '../../src/llm/types/agent-message.js';
import { serializeAgentMessage } from '../../src/memory/agent-db-models.js';
import {
  collectAbandonedPathRows,
  abandonedRowsToMessages,
} from '../../src/memory/branch-summarization.js';

describe('branch-summarization', () => {
  it('collectAbandonedPathRows returns tail when jumping to earlier branch point', () => {
    const rows = [
      { id: 1, session_id: 's', role: 'user', payload: '{}', parent_id: null, timestamp: 1 },
      { id: 2, session_id: 's', role: 'assistant', payload: '{}', parent_id: 1, timestamp: 2 },
      { id: 3, session_id: 's', role: 'user', payload: '{}', parent_id: 2, timestamp: 3 },
      { id: 4, session_id: 's', role: 'assistant', payload: '{}', parent_id: 3, timestamp: 4 },
    ];
    const abandoned = collectAbandonedPathRows(rows, 4, 2);
    expect(abandoned.map(r => r.id)).toEqual([3, 4]);
  });

  it('collectAbandonedPathRows is empty when leaf unchanged', () => {
    const rows = [
      { id: 1, session_id: 's', role: 'user', payload: '{}', parent_id: null, timestamp: 1 },
    ];
    expect(collectAbandonedPathRows(rows, 1, 1)).toEqual([]);
  });

  it('abandonedRowsToMessages parses user messages', () => {
    const u = serializeAgentMessage(createUserMessage('fork me'));
    u.id = 3;
    u.session_id = 's';
    const messages = abandonedRowsToMessages([u]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
  });
});
