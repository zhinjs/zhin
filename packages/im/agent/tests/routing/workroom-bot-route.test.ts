import { describe, expect, it } from 'vitest';
import { resolveWorkroomBotIdentity } from '../../src/routing/workroom-bot-identity.js';

describe('resolveWorkroomBotIdentity', () => {
  it('resolves an exact enabled Workroom Bot identity without granting execution routing', () => {
    expect(resolveWorkroomBotIdentity({
      support: {
        name: 'Support',
        members: [{ agent: 'support', role: 'executor' }, { agent: 'zhin', role: 'orchestrator' }],
        conversation: { adapter: 'telegram', endpoint: 'support-bot', kind: 'group', id: 'support-room', agent: 'support' },
      },
    }, { adapter: 'telegram', endpoint: 'support-bot', kind: 'group', id: 'support-room' })).toEqual({
      projectId: 'support',
      agent: 'support',
      role: 'executor',
      space: 'workroom',
    });
  });

  it('resolves a member Bot through its persisted messageRoute in the same shared room', () => {
    expect(resolveWorkroomBotIdentity({
      support: {
        name: 'Support',
        members: [
          { agent: 'zhin', role: 'orchestrator' },
          {
            agent: 'reviewer', role: 'reviewer',
            messageRoute: { adapter: 'icqq', endpoint: 'reviewer-bot' },
          },
        ],
        conversation: {
          adapter: 'icqq', endpoint: 'zhin-bot', kind: 'group', id: 'support-room', agent: 'zhin',
        },
      },
    }, { adapter: 'icqq', endpoint: 'reviewer-bot', kind: 'group', id: 'support-room' }))
      .toEqual({
        projectId: 'support', agent: 'reviewer', role: 'reviewer', space: 'workroom',
      });
  });

  it('ignores disabled Workrooms and rejects ambiguous enabled ownership', () => {
    const conversation = { adapter: 'telegram', endpoint: 'bot', kind: 'group' as const, id: 'room', agent: 'zhin' };
    const workroom = { name: 'Room', members: [{ agent: 'zhin', role: 'orchestrator' as const }], conversation };
    expect(resolveWorkroomBotIdentity({ disabled: { ...workroom, enabled: false } }, {
      adapter: 'telegram', endpoint: 'bot', kind: 'group', id: 'room',
    })).toBeNull();
    expect(() => resolveWorkroomBotIdentity({ a: workroom, b: workroom }, {
      adapter: 'telegram', endpoint: 'bot', kind: 'group', id: 'room',
    })).toThrow(/multiple enabled Workrooms/u);
  });

  it('routes every GitHub Issue/PR in a repository to its repository Workroom', () => {
    expect(resolveWorkroomBotIdentity({
      repo: {
        name: 'Repo',
        members: [{ agent: 'zhin', role: 'orchestrator' }],
        conversation: { adapter: 'github', endpoint: 'app', kind: 'repository', id: 'zhinjs/zhin', agent: 'zhin' },
      },
    }, { adapter: 'github', endpoint: 'app', kind: 'repository', id: 'ZHINJS/Zhin' })?.projectId).toBe('repo');
  });

  it('resolves an exact persisted Sponsor Room separately from the Workroom conversation', () => {
    expect(resolveWorkroomBotIdentity({
      support: {
        name: 'Support', sponsors: ['root:alice'],
        members: [{ agent: 'zhin', role: 'orchestrator' }],
        conversation: { adapter: 'telegram', endpoint: 'bot', kind: 'group', id: 'work', agent: 'zhin' },
        sponsorConversation: { adapter: 'telegram', endpoint: 'bot', kind: 'group', id: 'sponsors', agent: 'zhin' },
      },
    }, { adapter: 'telegram', endpoint: 'bot', kind: 'group', id: 'sponsors' })).toMatchObject({
      projectId: 'support', agent: 'zhin', role: 'orchestrator', space: 'sponsor_room',
    });
  });

  it('requires an explicit Project when one portfolio Sponsor Room serves several Projects', () => {
    const definition = (projectId: string) => ({
      name: projectId,
      members: [{ agent: 'zhin', role: 'orchestrator' as const }],
      conversation: { adapter: 'telegram', endpoint: 'bot', kind: 'group' as const, id: `work-${projectId}`, agent: 'zhin' },
      sponsorConversation: { adapter: 'telegram', endpoint: 'bot', kind: 'group' as const, id: 'portfolio', agent: 'zhin' },
    });
    const definitions = { alpha: definition('alpha'), beta: definition('beta') };
    const input = { adapter: 'telegram', endpoint: 'bot', kind: 'group' as const, id: 'portfolio' };
    expect(() => resolveWorkroomBotIdentity(definitions, input)).toThrow(/explicit Project/u);
    expect(resolveWorkroomBotIdentity(definitions, { ...input, projectId: 'beta' })).toMatchObject({
      projectId: 'beta', space: 'sponsor_room',
    });
    expect(() => resolveWorkroomBotIdentity(definitions, { ...input, projectId: 'missing' }))
      .toThrow(/explicit Project id is not a member/u);
  });
});
