import { describe, it, expect } from 'vitest';
import { createUserMessage } from '../../src/llm/types/agent-message.js';
import { serializeAgentMessage } from '../../src/memory/agent-db-models.js';
import {
  buildActivePathRows,
  listUserBranchPoints,
} from '../../src/memory/session-tree.js';

describe('session-tree', () => {
  it('buildActivePathRows follows parent_id chain', () => {
    const rows = [
      { id: 1, session_id: 's', role: 'user', payload: '{}', parent_id: null, timestamp: 1 },
      { id: 2, session_id: 's', role: 'assistant', payload: '{}', parent_id: 1, timestamp: 2 },
      { id: 3, session_id: 's', role: 'user', payload: '{}', parent_id: 2, timestamp: 3 },
      { id: 4, session_id: 's', role: 'assistant', payload: '{}', parent_id: 3, timestamp: 4 },
    ];
    const path = buildActivePathRows(rows, 4);
    expect(path.map(r => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('listUserBranchPoints indexes user messages on path', () => {
    const u1 = serializeAgentMessage(createUserMessage('hello'));
    u1.id = 1;
    u1.session_id = 's';
    u1.parent_id = null;
    const rows = [u1];
    const points = listUserBranchPoints(rows);
    expect(points).toHaveLength(1);
    expect(points[0].index).toBe(1);
    expect(points[0].messageId).toBe(1);
  });

  it('listUserBranchPoints preview uses clean payload + extra (not roles in text)', () => {
    const u1 = serializeAgentMessage(createUserMessage('你是谁'), {
      sender: {
        id: '1659488338',
        name: '归雨',
        roles: ['master', 'group_admin'],
        scope: 'group',
      },
    });
    u1.id = 1;
    u1.session_id = 's';
    u1.parent_id = null;
    const points = listUserBranchPoints([u1]);
    expect(points[0].preview).toBe('归雨: 你是谁');
    expect(points[0].preview).not.toContain('roles=');
  });
});
