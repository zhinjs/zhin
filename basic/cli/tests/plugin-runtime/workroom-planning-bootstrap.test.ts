import { describe, expect, it } from 'vitest';
import { createCapabilityPackManifest } from '@zhin.js/agent/runtime';
import { createWorkroomPlanningBootstrapArtifacts } from '../../src/plugin-runtime/workroom-planning-bootstrap.js';

describe('Workroom Planning Console bootstrap', () => {
  const digest = (char: string) => `sha256:${char.repeat(64)}`;
  const supply = {
    version: 1 as const,
    generation: 9,
    digest: digest('f'),
    tools: [{ name: 'bash', digest: digest('a') }],
    skills: [{ name: 'review-code', digest: digest('b') }],
    agents: [
      { id: 'planner', digest: digest('c') },
      { id: 'executor', digest: digest('d') },
      { id: 'reviewer', digest: digest('e') },
    ],
  };

  it('builds one exact Profile and Planning Policy from current generation capabilities', () => {
    const artifacts = createWorkroomPlanningBootstrapArtifacts({
      projectId: 'zhin',
      principalId: 'workroom-admin',
      supply,
      definition: {
        name: 'Zhin', sponsors: ['workroom-admin'],
        members: [
          { agent: 'planner', role: 'orchestrator' },
          { agent: 'executor', role: 'executor' },
          { agent: 'reviewer', role: 'reviewer' },
        ],
        conversation: {
          adapter: 'icqq', endpoint: 'main', kind: 'group', id: '100', agent: 'planner',
        },
      },
    });
    expect(artifacts.pack).toMatchObject({
      id: 'workroom:zhin:bootstrap',
      tools: [{ id: 'bash' }],
      skills: [{ id: 'review-code' }],
      agents: [
        { id: 'executor', role: 'executor' },
        { id: 'planner', role: 'orchestrator' },
        { id: 'reviewer', role: 'reviewer' },
      ],
      workflows: [{ id: 'workroom:zhin:dynamic', requiredByProfile: true }],
    });
    expect(artifacts.packInput).not.toHaveProperty('digest');
    expect(artifacts.packInput).toMatchObject({ id: artifacts.pack.id, version: artifacts.pack.version });
    expect(createCapabilityPackManifest(artifacts.packInput).digest).toBe(artifacts.pack.digest);
    expect(artifacts.overlay).toMatchObject({
      projectId: 'zhin', revisionId: 'profile:zhin:bootstrap:1',
      enabledAgents: ['executor', 'planner', 'reviewer'],
    });
    expect(artifacts.policy).toMatchObject({
      revisionId: 'planning:zhin:1', sponsorGate: { owner: 'workroom-admin' },
    });
  });

  it('rejects one Agent binding reused for multiple Workroom roles', () => {
    expect(() => createWorkroomPlanningBootstrapArtifacts({
      projectId: 'zhin', principalId: 'workroom-admin', supply,
      definition: {
        name: 'Zhin',
        members: [
          { agent: 'planner', role: 'orchestrator' },
          { agent: 'planner', role: 'executor' },
        ],
      },
    })).toThrow('每个 Workroom 角色需要独立 Agent binding');
  });

});
