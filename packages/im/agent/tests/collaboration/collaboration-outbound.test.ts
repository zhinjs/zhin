import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseCollaborationReplyJson,
  tryBuildCollaborationMentionSegments,
} from '../../src/collaboration/collaboration-outbound.js';
import {
  getCollaborationCellService,
  resetCollaborationCellService,
} from '../../src/collaboration/cell-service.js';
import { MemoryCollaborationCellRepository } from '../../src/collaboration/collaboration-cell-repository.js';
import type { Message } from '@zhin.js/core';

describe('parseCollaborationReplyJson', () => {
  it('parses bare JSON with mentions', () => {
    const raw = '{"mentions":["researcher","210723495"],"text":"请各位自我介绍"}';
    expect(parseCollaborationReplyJson(raw)).toEqual({
      mentions: ['researcher', '210723495'],
      text: '请各位自我介绍',
    });
  });

  it('parses fenced JSON', () => {
    const raw = '```json\n{"mentions":["planner"],"text":"你好"}\n```';
    expect(parseCollaborationReplyJson(raw)).toEqual({
      mentions: ['planner'],
      text: '你好',
    });
  });

  it('returns null for plain markdown', () => {
    expect(parseCollaborationReplyJson('@researcher 你好')).toBeNull();
  });

  it('returns null when text missing', () => {
    expect(parseCollaborationReplyJson('{"mentions":["a"]}')).toBeNull();
  });
});

describe.skip('legacy tryBuildCollaborationMentionSegments', () => {
  beforeEach(async () => {
    resetCollaborationCellService();
    const repo = new MemoryCollaborationCellRepository();
    await repo.upsert({
      id: 'room',
      adapter: 'icqq',
      sceneId: '373460458',
      members: [
        { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
        { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
      ],
    });
    getCollaborationCellService().setRepository(repo);
    await getCollaborationCellService().reloadFromRepository();
  });

  afterEach(() => {
    resetCollaborationCellService();
    vi.restoreAllMocks();
  });

  it('builds at segments from JSON reply in collaboration group', async () => {
    const core = await import('@zhin.js/core');
    vi.spyOn(core, 'getHostRootPlugin').mockReturnValue({
      inject: () => ({
        endpoints: new Map([
          ['210723495', { $platformUserId: '210723495' }],
        ]),
      }),
    } as never);

    const message = {
      $adapter: 'icqq',
      $endpoint: '8596238',
      $channel: { type: 'group', id: '373460458' },
    } as Message;

    const elements = [{
      type: 'text' as const,
      content: '{"mentions":["researcher"],"text":"请介绍一下你自己"}',
    }];

    const segments = await tryBuildCollaborationMentionSegments(message, elements);
    expect(segments).toEqual([
      { type: 'at', data: { id: '210723495', qq: '210723495' } },
      { type: 'text', data: { text: ' 请介绍一下你自己' } },
    ]);
  });

  it('rewrites plain @researcher in markdown to at segments', async () => {
    const core = await import('@zhin.js/core');
    vi.spyOn(core, 'getHostRootPlugin').mockReturnValue({
      inject: () => ({
        endpoints: new Map([
          ['210723495', { $platformUserId: '210723495' }],
        ]),
      }),
    } as never);

    const message = {
      $adapter: 'icqq',
      $endpoint: '8596238',
      $channel: { type: 'group', id: '373460458' },
    } as Message;

    const elements = [{
      type: 'text' as const,
      content: `好的，我先带头做个自我介绍！

---

现在邀请各位伙伴依次自我介绍！

@researcher 请先来～`,
    }];

    const segments = await tryBuildCollaborationMentionSegments(message, elements, {
      inboundContent: '@8596238 叫大家依次做个自我介绍',
    });
    expect(segments).toEqual([
      { type: 'at', data: { id: '210723495', qq: '210723495' } },
      { type: 'text', data: { text: ' 好的，我先带头做个自我介绍！\n\n---\n\n现在邀请各位伙伴依次自我介绍！\n\n 请先来～' } },
    ]);
  });

  it('rewrites plain @endpointId numeric ref to at segments', async () => {
    const core = await import('@zhin.js/core');
    vi.spyOn(core, 'getHostRootPlugin').mockReturnValue({
      inject: () => ({
        endpoints: new Map([
          ['210723495', { $platformUserId: '210723495' }],
        ]),
      }),
    } as never);

    const message = {
      $adapter: 'icqq',
      $endpoint: '8596238',
      $channel: { type: 'group', id: '373460458' },
    } as Message;

    const elements = [{
      type: 'text' as const,
      content: '@210723495 请发言。',
    }];

    const segments = await tryBuildCollaborationMentionSegments(message, elements);
    expect(segments).toEqual([
      { type: 'at', data: { id: '210723495', qq: '210723495' } },
      { type: 'text', data: { text: ' 请发言。' } },
    ]);
  });

  it('splits mixed prose + JSON into two outbound batches', async () => {
    const core = await import('@zhin.js/core');
    vi.spyOn(core, 'getHostRootPlugin').mockReturnValue({
      inject: () => ({
        endpoints: new Map([
          ['210723495', { $platformUserId: '210723495' }],
        ]),
      }),
    } as never);

    const message = {
      $adapter: 'icqq',
      $endpoint: '8596238',
      $channel: { type: 'group', id: '373460458' },
    } as Message;

    const elements = [{
      type: 'text' as const,
      content: `很好！Researcher已经完成了自我介绍。现在继续邀请下一位成员。

{"mentions":["210723495"],"text":"你好，Researcher！请继续。"}`,
    }];

    const { tryBuildCollaborationOutboundBatches } = await import('../../src/collaboration/collaboration-outbound.js');
    const batches = await tryBuildCollaborationOutboundBatches(message, elements);
    expect(batches).toEqual([
      [{ type: 'text', data: { text: ' 很好！Researcher已经完成了自我介绍。现在继续邀请下一位成员。' } }],
      [
        { type: 'at', data: { id: '210723495', qq: '210723495' } },
        { type: 'text', data: { text: ' 你好，Researcher！请继续。' } },
      ],
    ]);
  });

  it('splits prose with plain @ and trailing JSON (planner log case)', async () => {
    const core = await import('@zhin.js/core');
    vi.spyOn(core, 'getHostRootPlugin').mockReturnValue({
      inject: () => ({
        endpoints: new Map([
          ['8596238', { $platformUserId: '8596238' }],
          ['210723495', { $platformUserId: '210723495' }],
        ]),
      }),
    } as never);

    const message = {
      $adapter: 'icqq',
      $endpoint: '8596238',
      $channel: { type: 'group', id: '373460458' },
    } as Message;

    const elements = [{
      type: 'text' as const,
      content: `@8596238 团队目前 5 位成员整装待发！我来点名，各位依次自我介绍。**Researcher，你先来——**

{"mentions":["210723495"],"text":"请介绍你自己：角色名称、职责定位、擅长领域、个人宣言。完成后 汇报。"}`,
    }];

    const { tryBuildCollaborationOutboundBatches } = await import('../../src/collaboration/collaboration-outbound.js');
    const batches = await tryBuildCollaborationOutboundBatches(message, elements, {
      inboundContent: '@8596238 组织大家，一个个的给我做个自我介绍',
    });
    expect(batches).toHaveLength(2);
    expect(batches![0]).toEqual([{
      type: 'text',
      data: { text: ' @8596238 团队目前 5 位成员整装待发！我来点名，各位依次自我介绍。**Researcher，你先来——**' },
    }]);
    expect(batches![1]).toEqual([
      { type: 'at', data: { id: '210723495', qq: '210723495' } },
      { type: 'text', data: { text: ' 请介绍你自己：角色名称、职责定位、擅长领域、个人宣言。完成后 汇报。' } },
    ]);
  });
});

describe('collaboration outbound harness helpers', () => {
  const cell = {
    id: 'room',
    adapter: 'icqq',
    sceneId: '1',
    members: [
      { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' as const },
      { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' as const },
    ],
  };

  it('stripPlannerPublicMentionsFromSegments removes self @', async () => {
    const { stripPlannerPublicMentionsFromSegments } = await import('../../src/collaboration/collaboration-outbound.js');
    const adapter = {
      endpoints: new Map([['8596238', { $platformUserId: '8596238' }]]),
    };
    const out = stripPlannerPublicMentionsFromSegments(
      [{ type: 'text', data: { text: ' @8596238 大家好' } }],
      cell,
      '8596238',
      adapter as never,
    );
    expect(out).toEqual([{ type: 'text', data: { text: ' 大家好' } }]);
  });

  it('isCollaborationNoOpReasoningOutbound detects meta silence', async () => {
    const { isCollaborationNoOpReasoningOutbound } = await import('../../src/collaboration/collaboration-outbound.js');
    expect(isCollaborationNoOpReasoningOutbound([
      [{ type: 'text', data: { text: "This is a reply to another agent, not to me. I'll stay silent." } }],
    ])).toBe(true);
    expect(isCollaborationNoOpReasoningOutbound([
      [{ type: 'at', data: { id: '8596238' } }, { type: 'text', data: { text: ' 已完成' } }],
    ])).toBe(false);
  });

  it('filterPipelineDelegateeOutboundBatches drops tool JSON instead of falling back', async () => {
    const { filterPipelineDelegateeOutboundBatches } = await import('../../src/collaboration/collaboration-outbound.js');
    const toolJson = JSON.stringify({ ok: true, cellId: 'c1', pipelineState: { runId: 'r1' } });
    const delegateeCell = {
      ...cell,
      pipelineState: {
        runId: 'r1',
        stage: 'researcher' as const,
        reviewCycles: 0,
        maxReviewCycles: 3,
        allowedNextStages: ['evaluator'],
        todo: [],
        activeDelegations: [{
          targetEndpointId: '210723495',
          targetRole: 'researcher' as const,
          runId: 'r1',
          requireArtifact: true,
          artifactKinds: ['report' as const],
          delegateText: '调研',
          updatedAt: 1,
        }],
        updatedAt: 1,
      },
    };
    const out = filterPipelineDelegateeOutboundBatches(
      [[{ type: 'text', data: { text: toolJson } }]],
      delegateeCell,
      '210723495',
    );
    expect(out).toEqual([]);
  });
});
