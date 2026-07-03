import { describe, it, expect } from 'vitest';
import { resolvePeerEndpointInCell } from '../../src/collaboration/collaboration-config.js';
import type { CollaborationCell } from '../../src/collaboration/types.js';

const cell: CollaborationCell = {
  id: 'room',
  adapter: 'icqq',
  sceneId: '373460458',
  members: [
    { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
    { endpointId: '1689919782', primary: 'evaluator', pipelineRole: 'evaluator' },
    { endpointId: '329158210', primary: 'executor', pipelineRole: 'executor' },
    { endpointId: '717505091', primary: 'reviewer', pipelineRole: 'reviewer' },
  ],
};

describe('resolvePeerEndpointInCell', () => {
  it('resolves by endpoint ID', () => {
    expect(resolvePeerEndpointInCell(cell, '210723495')).toBe('210723495');
  });

  it('resolves by pipelineRole', () => {
    expect(resolvePeerEndpointInCell(cell, 'researcher')).toBe('210723495');
    expect(resolvePeerEndpointInCell(cell, 'Researcher')).toBe('210723495');
  });

  it('resolves by primary agent name', () => {
    expect(resolvePeerEndpointInCell(cell, 'evaluator')).toBe('1689919782');
  });

  it('returns undefined for unknown peer', () => {
    expect(resolvePeerEndpointInCell(cell, '@researcher')).toBeUndefined();
    expect(resolvePeerEndpointInCell(cell, 'unknown')).toBeUndefined();
  });
});
