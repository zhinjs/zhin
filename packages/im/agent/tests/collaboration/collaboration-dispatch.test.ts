import { describe, expect, it } from 'vitest';
import { assertPeerMember } from '../../src/collaboration/collaboration-dispatch.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';

const cell: CollaborationScene = {
  id: 'room-alpha',
  adapter: 'sandbox',
  sceneId: 'group-1',
  members: [
    { endpointId: 'planner-bot', primary: 'planner' },
    { endpointId: 'researcher-bot', primary: 'researcher' },
  ],
};

describe('assertPeerMember', () => {
  it('passes for bound members', () => {
    expect(() => assertPeerMember(cell, 'researcher-bot')).not.toThrow();
  });

  it('throws for unknown endpoint', () => {
    expect(() => assertPeerMember(cell, 'outsider-bot')).toThrow(/not a member/);
  });
});
