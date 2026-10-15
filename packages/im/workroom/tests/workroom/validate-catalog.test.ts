import { describe, it, expect } from 'vitest';
import { validateWorkroomDefinitions } from '../../src/workroom/validate-catalog.js';

describe('validateWorkroomDefinitions', () => {
  it('校验 Workroom 的 Agent 成员、角色与协作空间关联', () => {
    const workrooms = {
        support: {
          name: '客户支持',
          members: [
            { agent: 'zhin', role: 'orchestrator' },
            { agent: 'reviewer', role: 'reviewer' },
          ],
          conversation: { adapter: 'telegram', endpoint: 'support-bot', kind: 'group', id: '10001', agent: 'zhin' },
        },
    };
    expect(validateWorkroomDefinitions(workrooms, ['zhin', 'reviewer'])).toEqual([]);

    workrooms.support.conversation.agent = 'missing';
    expect(validateWorkroomDefinitions(workrooms, ['zhin', 'reviewer'])).toContain(
      'workroomCatalog.support.conversation.agent: Agent must be a Workroom member',
    );
  });

  it('校验成员消息出口必须指向唯一、已配置的 Bot Endpoint', () => {
    const workrooms = {
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
          adapter: 'icqq', endpoint: 'zhin-bot', kind: 'group', id: '10001', agent: 'zhin',
        },
      },
    };
    expect(validateWorkroomDefinitions(
      workrooms,
      ['zhin', 'reviewer'],
      new Set(['icqq:zhin-bot', 'icqq:reviewer-bot']),
    )).toEqual([]);
    expect(validateWorkroomDefinitions(
      workrooms,
      ['zhin', 'reviewer'],
      new Set(['icqq:zhin-bot']),
    )).toContain(
      'workroomCatalog.support.members.1.messageRoute: unknown configured Bot Endpoint "icqq:reviewer-bot"',
    );
  });

  it('允许同一 Bot Endpoint 服务多个群，但拒绝重复绑定同一个完整会话地址', () => {
    const definition = (id: string) => ({
      name: 'Room',
      members: [{ agent: 'zhin', role: 'orchestrator' }],
      conversation: { adapter: 'telegram', endpoint: 'shared', kind: 'group', id, agent: 'zhin' },
    });
    const workrooms = { alpha: definition('group-a'), beta: definition('group-b') };
    expect(validateWorkroomDefinitions(workrooms, ['zhin'])).toEqual([]);
    workrooms.beta.conversation.id = 'group-a';
    expect(validateWorkroomDefinitions(workrooms, ['zhin'])).toContain(
      'workroomCatalog.beta.conversation: conversation "telegram:shared:group:group-a" is already owned by enabled Workroom "alpha"',
    );
  });

  it('treats the persisted Sponsor Room as a distinct exact conversation authority', () => {
    const workrooms = {
      project: {
        name: 'Project', sponsors: ['root:alice'],
        members: [{ agent: 'zhin', role: 'orchestrator' }],
        conversation: { adapter: 'telegram', endpoint: 'bot', kind: 'group', id: 'work', agent: 'zhin' },
        sponsorConversation: { adapter: 'telegram', endpoint: 'bot', kind: 'group', id: 'sponsors', agent: 'zhin' },
      },
    };
    expect(validateWorkroomDefinitions(workrooms, ['zhin'])).toEqual([]);
    workrooms.project.sponsorConversation.id = 'work';
    expect(validateWorkroomDefinitions(workrooms, ['zhin'])).toContain(
      'workroomCatalog.project.sponsorConversation: conversation "telegram:bot:group:work" is already owned by enabled Workroom "project"',
    );
  });

  it('rejects repository conversations as Sponsor Rooms', () => {
    const project = {
      name: 'Project', sponsors: ['root:alice'],
      members: [{ agent: 'zhin', role: 'orchestrator' }],
      conversation: { adapter: 'telegram', endpoint: 'bot', kind: 'group', id: 'work', agent: 'zhin' },
      sponsorConversation: {
        adapter: 'github', endpoint: 'app', kind: 'repository', id: 'zhinjs/zhin', agent: 'zhin',
      },
    };
    expect(validateWorkroomDefinitions({ project }, ['zhin'])).toContain(
      'workroomCatalog.project.sponsorConversation.kind: Sponsor Room must be a group or channel',
    );
  });

  it('allows one portfolio Sponsor Room to expose Project-scoped delivery views', () => {
    const definition = (project: string) => ({
      name: project, sponsors: ['root:alice'],
      members: [{ agent: 'zhin', role: 'orchestrator' }],
      conversation: { adapter: 'telegram', endpoint: 'bot', kind: 'group', id: `work-${project}`, agent: 'zhin' },
      sponsorConversation: { adapter: 'telegram', endpoint: 'bot', kind: 'group', id: 'portfolio-sponsors', agent: 'zhin' },
    });
    expect(validateWorkroomDefinitions({ alpha: definition('alpha'), beta: definition('beta') }, ['zhin']))
      .toEqual([]);
    expect(validateWorkroomDefinitions({
      alpha: definition('alpha'),
      beta: { ...definition('beta'), sponsors: ['root:bob'] },
    }, ['zhin'])).toContain(
      'portfolio Sponsor Room "telegram:bot:group:portfolio-sponsors" requires the same non-empty Sponsor audience for Projects "alpha,beta"',
    );
  });

  it('接受 GitHub 仓库作为 Workroom 协作空间', () => {
    const workrooms = {
        zhin: {
          name: 'Zhin repo',
          members: [{ agent: 'zhin', role: 'orchestrator' }],
          conversation: { adapter: 'github', endpoint: 'app', kind: 'repository', id: 'zhinjs/zhin', agent: 'zhin' },
        },
    };
    expect(validateWorkroomDefinitions(workrooms, ['zhin'])).toEqual([]);
  });

  it('校验持久 Assignment locality 与远程 endpoint 绑定', () => {
    const workrooms = {
      routed: {
        name: 'Routed',
        members: [{
          agent: 'zhin', role: 'orchestrator',
          assignmentRoute: { kind: 'remote', endpointId: 'a2a-prod' },
        }],
        conversation: { adapter: 'telegram', endpoint: 'bot', kind: 'group', id: 'route', agent: 'zhin' },
      },
    };
    expect(validateWorkroomDefinitions(workrooms, ['zhin'])).toEqual([]);
    workrooms.routed.members[0]!.assignmentRoute.endpointId = '  ';
    expect(validateWorkroomDefinitions(workrooms, ['zhin'])).toContain(
      'workroomCatalog.routed.members.0.assignmentRoute.endpointId: endpoint id is required',
    );
  });
});
