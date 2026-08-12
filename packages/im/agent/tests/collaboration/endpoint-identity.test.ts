import { describe, it, expect } from 'vitest';
import {
  resolveEndpointKeysForMember,
  resolveMemberBySender,
} from '../../src/collaboration/endpoint-identity.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';

const cell: CollaborationScene = {
  id: 'room',
  adapter: 'icqq',
  sceneId: '373460458',
  members: [
    { endpointKey: '8596238', primary: 'planner', pipelineRole: 'planner' },
    { endpointKey: '210723495', primary: 'executor', pipelineRole: 'executor' },
  ],
};

const fakeRoot = {
  inject: () => ({
    endpoints: new Map<string, { $platformUserId?: string; $config?: Record<string, unknown> }>([
      ['8596238', { $platformUserId: '8596238' }],
      ['210723495', { $config: { id: 'exec-bot' } }],
    ]),
  }),
} as unknown as import('@zhin.js/core').Plugin;

describe('resolveEndpointKeysForMember', () => {
  it('collects endpointKey + platformUserId + config.id', () => {
    expect(resolveEndpointKeysForMember(fakeRoot, 'icqq', '210723495')).toEqual(
      expect.arrayContaining(['210723495', 'exec-bot']),
    );
  });

  it('falls back to endpointKey when root missing', () => {
    expect(resolveEndpointKeysForMember(undefined, 'icqq', '8596238')).toEqual(['8596238']);
  });
});

describe('resolveMemberBySender', () => {
  it('matches peer bot by platform id', () => {
    expect(resolveMemberBySender(cell, '8596238', fakeRoot)?.primary).toBe('planner');
    expect(resolveMemberBySender(cell, 'exec-bot', fakeRoot)?.primary).toBe('executor');
  });

  it('returns undefined for human sender', () => {
    expect(resolveMemberBySender(cell, '1659488338', fakeRoot)).toBeUndefined();
  });
});
