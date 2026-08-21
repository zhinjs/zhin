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
});
