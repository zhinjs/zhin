import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@zhin.js/tool';
import {
  createScheduleTools,
  type ScheduleManager,
} from '../src/schedule-manager.js';
import { runWithAgentTurnConfiguration } from '../src/turn/agent-turn-context.js';

const context = {
  signal: new AbortController().signal,
  traceId: 'trace-schedule',
  turnId: 'turn-schedule',
  sessionKey: 'im:qq:bot:private:u1',
  origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: 'u1' },
  principal: { subjectId: 'u1', displayName: 'Alice', roles: ['owner'] },
} as ToolExecutionContext;

function manager(listJobs: ScheduleManager['engine'] extends infer _T ? () => Promise<unknown[]> : never): ScheduleManager {
  return {
    scheduleFeature: { getStatus: () => [] },
    engine: {
      listJobs,
    } as unknown as NonNullable<ScheduleManager['engine']>,
  };
}

function tool(managerValue: ScheduleManager, name: string) {
  return createScheduleTools(managerValue).find((entry) => entry.name === name)!.definition;
}

describe('canonical schedule tools', () => {
  it('captures the invocation principal and IM target when adding a job', async () => {
    const addJob = vi.fn(async (input) => ({
      ...input,
      createdAt: 1,
      updatedAt: 1,
      state: {},
    }));
    const value = {
      scheduleFeature: { getStatus: () => [] },
      engine: { addJob },
    } as unknown as ScheduleManager;

    const result = await tool(value, 'schedule_add').execute({
      delay_minutes: 5,
      prompt: 'remind me',
      notify_channel: 'im',
    }, context) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(addJob).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: { userId: 'u1', name: 'Alice', roles: ['owner'] },
      notify: {
        channel: 'im',
        target: {
          channel: 'im',
          scene: {
            platform: 'qq', endpointKey: 'bot', sceneId: 'u1', kind: 'private', senderId: 'u1',
          },
        },
      },
    }));
  });

  it('keeps each definition bound to its own generation manager', async () => {
    const previous = manager(async () => [{
      id: 'previous', enabled: true, schedule: { kind: 'at', atMs: 1 },
      action: { kind: 'agent', prompt: 'old' }, notify: { channel: 'silent' },
      createdAt: 1, updatedAt: 1, state: {},
    }]);
    const next = manager(async () => [{
      id: 'next', enabled: true, schedule: { kind: 'at', atMs: 2 },
      action: { kind: 'agent', prompt: 'new' }, notify: { channel: 'silent' },
      createdAt: 2, updatedAt: 2, state: {},
    }]);
    const previousTool = tool(previous, 'schedule_list');
    tool(next, 'schedule_list');

    const result = await previousTool.execute({}, context) as { persistent: Array<{ id: string }> };
    expect(result.persistent.map((job) => job.id)).toEqual(['previous']);
  });
});

describe('schedule tools empty-plan and unattended hints (#1250 b33)', () => {
  function adding() {
    const addJob = vi.fn(async (input: Record<string, unknown>) => ({ ...input, createdAt: 1, updatedAt: 1, state: {} }));
    return { addJob, value: { scheduleFeature: { getStatus: () => [] }, engine: { addJob } } as unknown as ScheduleManager };
  }

  it('accepts a plan without tools or skills but warns that tools will be chosen from the prompt', async () => {
    const { addJob, value } = adding();
    const result = await tool(value, 'schedule_add').execute({
      cron: '0 0 9 * * *', schedule_kind: 'workday', prompt: '天气早报', notify_channel: 'im',
      execution_plan: { prompt: '查询上海天气并发早报' },
    }, context) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(addJob).toHaveBeenCalledOnce();
    expect(result.warning).toContain('schedule_preview');
  });

  it('does not warn when the plan names tools, or when there is no plan', async () => {
    const withTools = adding();
    const named = await tool(withTools.value, 'schedule_add').execute({
      delay_minutes: 5, prompt: '天气', notify_channel: 'im', tools: 'weather',
    }, context) as Record<string, unknown>;
    expect(named.warning).toBeUndefined();
    const plain = adding();
    const none = await tool(plain.value, 'schedule_add').execute({ delay_minutes: 5, prompt: '天气', notify_channel: 'im' }, context) as Record<string, unknown>;
    expect(none.warning).toBeUndefined();
  });

  it('lists in schedule_preview the tools an unattended run cannot use freely', async () => {
    const previewTask = vi.fn(async () => ({
      success: true, responseText: '上海晴', executionPlan: { prompt: 'p', tools: ['weather', 'kick'] },
      audit: { unattendedApproval: { review: 'none', denied: ['weather', 'kick'], reviewed: [] } },
    }));
    const value = { scheduleFeature: { getStatus: () => [] }, engine: null, previewTask } as unknown as ScheduleManager;
    const result = await tool(value, 'schedule_preview').execute({ prompt: '天气' }, context) as Record<string, unknown>;
    expect(result.unattended_approval).toEqual({ review: 'none', denied: ['weather', 'kick'], reviewed: [] });
    expect(result.message).toContain('无人值守执行时，这些工具会被拒绝：`weather`、`kick`');
  });

  it('names reviewed tools under auto review and stays quiet when nothing needs approval', async () => {
    const reviewed = vi.fn(async () => ({ success: true, responseText: 'ok', audit: {
      unattendedApproval: { review: 'auto', denied: [], reviewed: ['weather'] } } }));
    const value = { scheduleFeature: { getStatus: () => [] }, engine: null, previewTask: reviewed } as unknown as ScheduleManager;
    const result = await tool(value, 'schedule_preview').execute({ prompt: '天气' }, context) as Record<string, unknown>;
    expect(result.message).toContain('交给自动审核');
    const quiet = vi.fn(async () => ({ success: true, responseText: 'ok', audit: {
      unattendedApproval: { review: 'auto', denied: [], reviewed: [] } } }));
    const plain = await tool({ ...value, previewTask: quiet } as ScheduleManager, 'schedule_preview').execute({ prompt: '天气' }, context) as Record<string, unknown>;
    expect(plain).not.toHaveProperty('unattended_approval');
  });

  describe('agent (#1250 b52)', () => {
    function agentManager() {
      const addJob = vi.fn(async (input) => ({ ...input, createdAt: 1, updatedAt: 1, state: {} }));
      const value = {
        scheduleFeature: { getStatus: () => [] },
        engine: { addJob },
        agents: () => ['zhin', 'news', 'secret'],
      } as unknown as ScheduleManager;
      return { addJob, add: tool(value, 'schedule_add') };
    }
    // The Agents the caller's turn can see, as `@name` routing offers them (`capabilities.agents`).
    const inTurn = <T>(visible: readonly string[], run: () => Promise<T>) =>
      runWithAgentTurnConfiguration({ availableAgents: visible }, run);

    it('stores an Agent visible in the caller\'s turn; without `agent` the job has none, as before', async () => {
      const { addJob, add } = agentManager();
      const result = await inTurn(['news'], () => add.execute({ delay_minutes: 5, prompt: '早报', notify_channel: 'silent', agent: 'news' }, context)) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(addJob.mock.calls[0]![0].action).toEqual({ kind: 'agent', prompt: '早报', agent: 'news' });
      await inTurn(['news'], () => add.execute({ delay_minutes: 5, prompt: '早报', notify_channel: 'silent' }, context));
      expect(addJob.mock.calls[1]![0].action).toEqual({ kind: 'agent', prompt: '早报' });
      // The default Agent needs no visibility.
      await inTurn([], () => add.execute({ delay_minutes: 5, prompt: '早报', notify_channel: 'silent', agent: 'zhin' }, context));
      expect(addJob.mock.calls[2]![0].action).toEqual({ kind: 'agent', prompt: '早报', agent: 'zhin' });
    });

    it('refuses an Agent the caller cannot use, without revealing it, and an unknown one', async () => {
      const { addJob, add } = agentManager();
      const hidden = await inTurn(['news'], () => add.execute({ delay_minutes: 5, prompt: 'x', notify_channel: 'silent', agent: 'secret' }, context)) as Record<string, unknown>;
      expect(hidden.error).toBe('Agent 不存在或无权使用：secret。可用的 Agent：zhin、news');
      const unknown = await inTurn(['news', 'ghost'], () => add.execute({ delay_minutes: 5, prompt: 'x', notify_channel: 'silent', agent: 'ghost' }, context)) as Record<string, unknown>;
      expect(unknown.error).toContain('Agent 不存在或无权使用：ghost');
      // Outside a runtime turn nothing is known about the caller's access: the default only.
      const outside = await add.execute({ delay_minutes: 5, prompt: 'x', notify_channel: 'silent', agent: 'news' }, context) as Record<string, unknown>;
      expect(outside.error).toBe('Agent 不存在或无权使用：news。可用的 Agent：zhin');
      expect(addJob).not.toHaveBeenCalled();
    });

    it('schedule_list shows the Agent of each persistent job', async () => {
      const value = manager(async () => [
        { id: 'a', enabled: true, schedule: { kind: 'at', atMs: 1 }, action: { kind: 'agent', prompt: 'p', agent: 'news' }, notify: { channel: 'silent' }, createdAt: 1, updatedAt: 1, state: {} },
        { id: 'b', enabled: true, schedule: { kind: 'at', atMs: 1 }, action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'silent' }, createdAt: 1, updatedAt: 1, state: {} },
      ]);
      const result = await inTurn(['news'], () => tool(value, 'schedule_list').execute({}, context)) as { persistent: Record<string, unknown>[] };
      expect(result.persistent[0]).toMatchObject({ id: 'a', agent: 'news' });
      expect(result.persistent[1]).not.toHaveProperty('agent');
      expect(result.persistent[0]).not.toHaveProperty('agent_missing');
    });

    it('schedule_list flags a job whose Agent was removed from ai.agents', async () => {
      const value = { ...manager(async () => [
        { id: 'gone', enabled: true, schedule: { kind: 'at', atMs: 1 }, action: { kind: 'agent', prompt: 'p', agent: 'deleted' }, notify: { channel: 'silent' }, createdAt: 1, updatedAt: 1, state: {} },
        { id: 'ok', enabled: true, schedule: { kind: 'at', atMs: 1 }, action: { kind: 'agent', prompt: 'p', agent: 'news' }, notify: { channel: 'silent' }, createdAt: 1, updatedAt: 1, state: {} },
      ]), agents: () => ['zhin', 'news'] };
      const result = await tool(value, 'schedule_list').execute({}, context) as { persistent: Record<string, unknown>[] };
      expect(result.persistent[0]).toMatchObject({ id: 'gone', agent: 'deleted', agent_missing: true });
      expect(result.persistent[1]).not.toHaveProperty('agent_missing');
    });
  });
});

describe('schedule job ownership in chat (#1250 b55)', () => {
  const conversation = (adapter: string, endpoint: string, id: string, kind: 'private' | 'group' = 'group') =>
    ({ endpoint: { adapter, id: endpoint }, kind, id });
  const caller = (subjectId: string, roles: string[], sceneId = 'g1', endpoint = 'bot') => ({
    ...context,
    origin: { kind: 'im', platform: 'qq', endpoint, scope: 'group', sceneId, conversation: conversation('qq', endpoint, sceneId) },
    principal: { subjectId, roles },
  }) as ToolExecutionContext;
  const owner = caller('boss', ['owner', 'admin', 'trusted']);
  const alice = caller('alice', ['user']);
  const aliceElsewhere = caller('alice', ['user'], 'g1', 'other-bot');
  const bob = caller('bob', ['user'], 'g2');
  const groupAdmin = caller('carol', ['admin', 'trusted'], 'g2');
  const imNotify = (sceneId: string) => ({ channel: 'im', target: { channel: 'im', scene: { platform: 'qq', endpointKey: 'bot', sceneId, kind: 'group' } } });
  const createdBy = (userId: string, endpoint = 'bot', sceneId = 'g1') => ({ userId, roles: ['user'], chat: { conversation: conversation('qq', endpoint, sceneId), endpointId: endpoint } });
  const job = (id: string, extra: Record<string, unknown>) => ({
    id, enabled: true, schedule: { kind: 'at', atMs: 1 }, action: { kind: 'agent', prompt: `secret ${id}` },
    notify: { channel: 'silent' }, createdAt: 1, updatedAt: 1, state: {}, ...extra,
  });
  const rows = () => [
    job('mine', { createdBy: createdBy('alice'), notify: imNotify('g1') }),
    job('bobs', { createdBy: createdBy('bob', 'bot', 'g2'), notify: imNotify('g1') }),
    job('bobs-quiet', { createdBy: createdBy('bob', 'bot', 'g2') }),
    job('console', {}),
    job('cli-to-g2', { notify: imNotify('g2') }),
    job('assistant-profile-morning-brief', { source: 'profile', notify: imNotify('g2') }),
  ];
  function engineManager() {
    const engine = {
      listJobs: vi.fn(async () => rows()),
      removeJob: vi.fn(async () => true),
      pauseJob: vi.fn(async () => true),
      resumeJob: vi.fn(async () => true),
    };
    const value = { scheduleFeature: { getStatus: () => [] }, engine } as unknown as ScheduleManager;
    return { engine, value };
  }
  const listIds = async (value: ScheduleManager, who: ToolExecutionContext) =>
    ((await tool(value, 'schedule_list').execute({}, who)) as { persistent: Array<{ id: string }> }).persistent.map(row => row.id);

  it('schedule_list: an owner sees every job', async () => {
    const { value } = engineManager();
    expect(await listIds(value, owner)).toEqual(rows().map(row => row.id));
  });

  it('schedule_list: anyone else sees their own jobs and those delivering to this conversation', async () => {
    const { value } = engineManager();
    // alice in g1: her own job, and bob's job that delivers to g1; not bob's quiet job, not Console / CLI / profile jobs elsewhere.
    expect(await listIds(value, alice)).toEqual(['mine', 'bobs']);
    // bob in g2: his own jobs (wherever they deliver), and the CLI job and profile routine delivering to g2.
    expect(await listIds(value, bob)).toEqual(['bobs', 'bobs-quiet', 'cli-to-g2', 'assistant-profile-morning-brief']);
    // The same user id on another account is somebody else.
    expect(await listIds(value, aliceElsewhere)).toEqual([]);
    // Group admins get no wider view.
    expect(await listIds(value, groupAdmin)).toEqual(['cli-to-g2', 'assistant-profile-morning-brief']);
  });

  it('schedule_list names only Agents visible in this turn (plus the default), others as 其他 Agent', async () => {
    const value = {
      scheduleFeature: { getStatus: () => [] },
      engine: { listJobs: async () => [
        job('news', { action: { kind: 'agent', prompt: 'p', agent: 'news' } }),
        job('hidden', { action: { kind: 'agent', prompt: 'p', agent: 'secret' } }),
        job('zhin', { action: { kind: 'agent', prompt: 'p', agent: 'zhin' } }),
      ] },
      agents: () => ['zhin', 'news', 'secret'],
    } as unknown as ScheduleManager;
    const result = await runWithAgentTurnConfiguration({ availableAgents: ['news'] },
      () => tool(value, 'schedule_list').execute({}, owner)) as { persistent: Record<string, unknown>[] };
    expect(result.persistent[0]).toMatchObject({ id: 'news', agent: 'news' });
    expect(result.persistent[1]).toMatchObject({ id: 'hidden', agent: '其他 Agent', agent_hidden: true });
    expect(JSON.stringify(result.persistent[1])).not.toContain('secret');
    expect(result.persistent[2]).toMatchObject({ id: 'zhin', agent: 'zhin' });
    expect(result.persistent[2]).not.toHaveProperty('agent_hidden');
  });

  for (const operation of ['remove', 'pause', 'resume'] as const) {
    const engineMethod = `${operation}Job` as 'removeJob' | 'pauseJob' | 'resumeJob';

    it(`schedule_${operation}: the creator and an owner may; others, group admins included, may not`, async () => {
      const { engine, value } = engineManager();
      const run = (id: string, who: ToolExecutionContext) => tool(value, `schedule_${operation}`).execute({ id }, who) as Promise<Record<string, unknown>>;
      expect(await run('mine', alice)).toEqual({ success: true });
      expect(await run('bobs', owner)).toEqual({ success: true });
      const refused = await run('bobs', alice);
      expect(refused).toEqual({ error: '这不是你创建的任务，只有任务的创建者或所有者可以管理它' });
      expect(JSON.stringify(refused)).not.toContain('secret');
      expect((await run('mine', aliceElsewhere)).error).toContain('不是你创建的任务');
      expect((await run('bobs', groupAdmin)).error).toContain('不是你创建的任务');
      // Jobs created outside chat (Console, CLI) belong to the owner only.
      expect((await run('console', alice)).error).toContain('不是你创建的任务');
      expect(await run('console', owner)).toEqual({ success: true });
      expect(await run('ghost', owner)).toEqual({ error: '未找到' });
      expect(engine[engineMethod].mock.calls.map(call => call[0])).toEqual(['mine', 'bobs', 'console']);
    });

    it(`schedule_${operation}: a profile routine is changed in the Profile file, even by an owner`, async () => {
      const { engine, value } = engineManager();
      const result = await tool(value, `schedule_${operation}`).execute({ id: 'assistant-profile-morning-brief' }, owner) as Record<string, unknown>;
      expect(result.error).toContain('assistant.profile.yml');
      expect(result.error).toContain('assistant.profile.file');
      // Someone else is only told it is not theirs.
      const other = await tool(value, `schedule_${operation}`).execute({ id: 'assistant-profile-morning-brief' }, bob) as Record<string, unknown>;
      expect(other.error).toContain('不是你创建的任务');
      expect(engine[engineMethod]).not.toHaveBeenCalled();
    });
  }

  it('a job created through schedule_add is managed by its creator afterwards', async () => {
    const stored: Record<string, unknown>[] = [];
    const engine = {
      addJob: vi.fn(async (input: Record<string, unknown>) => { const full = { ...input, createdAt: 1, updatedAt: 1, state: {} }; stored.push(full); return full; }),
      listJobs: vi.fn(async () => stored),
      pauseJob: vi.fn(async () => true),
    };
    const value = { scheduleFeature: { getStatus: () => [] }, engine } as unknown as ScheduleManager;
    const added = await tool(value, 'schedule_add').execute({ delay_minutes: 5, prompt: 'p', notify_channel: 'silent' }, alice) as { id: string };
    expect(await listIds(value, alice)).toEqual([added.id]);
    expect(await listIds(value, bob)).toEqual([]);
    expect(await tool(value, 'schedule_pause').execute({ id: added.id }, alice)).toEqual({ success: true });
    expect((await tool(value, 'schedule_pause').execute({ id: added.id }, bob) as Record<string, unknown>).error).toContain('不是你创建的任务');
  });
});
