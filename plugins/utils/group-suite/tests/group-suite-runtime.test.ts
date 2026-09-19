import { describe, expect, it, beforeEach } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { parseMiddlewareDefinition } from 'zhin.js/middleware';
import { parseAgentToolDefinition } from '@zhin.js/tool';
import plugin from '../plugin.ts';
import checkinCommand from '../commands/$checkin.ts';
import mypointsCommand from '../commands/$mypoints.ts';
import rankCommand from '../commands/$rank.ts';
import keywordList from '../commands/$keyword-list.ts';
import keywordAdd from '../commands/keyword-add/$[keyword].ts';
import keywordMiddleware from '../middlewares/$keyword-reply.ts';
import teachCommand from '../commands/$teach.ts';
import teachListCommand from '../commands/teach-list/$[[page]].ts';
import forgetCommand from '../commands/$forget.ts';
import teachMiddleware from '../middlewares/$teach-reply.ts';
import statsCommand from '../commands/$stats.ts';
import mystatsCommand from '../commands/$mystats.ts';
import statsMiddleware from '../middlewares/$stats-count.ts';
import checkinQueryTool from '../agent/tools/$checkin_query.ts';
import checkinRankTool from '../agent/tools/$checkin_rank.ts';
import statsQueryTool from '../agent/tools/$stats_query.ts';
import statsUserTool from '../agent/tools/$stats_user.ts';
import groupAnnounceTool from '../agent/tools/$group_announce.ts';
import {
  addKeyword,
  listKeywords,
  matchKeyword,
  resolveGroupSuiteConfig,
  recordMessage,
  tryTeachReply,
  doCheckin,
  myPoints,
  createGroupSuiteRuntime,
  flushStatsBuffer,
  getStatsModel,
  queryStats,
  type GroupSuiteRuntime,
} from '../src/index.js';
import { createInMemoryGroupSuiteDb } from '../src/memory-store.js';

let runtime: GroupSuiteRuntime;

const emptyCtx = {
  owner: {} as never,
  generation: 0,
  config: {},
  use: () => runtime as never,
  args: [] as string[],
  params: {} as Record<string, string | number | boolean>,
  input: undefined as never,
};

const groupInput = {
  sender: { id: 'u1', name: 'Alice' },
  conversation: { kind: 'group', id: 'g1' },
  content: '',
  metadata: { type: 'group', senderName: 'Alice' },
};

describe('@zhin.js/plugin-group-suite runtime (slice-2)', () => {
  beforeEach(() => {
    runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('group-suite');
  });

  it('brands checkin / keyword / teach / stats commands and middlewares', () => {
    expect(parseCommandDefinition(checkinCommand)).toBe(checkinCommand);
    expect(parseCommandDefinition(keywordList)).toBe(keywordList);
    expect(parseCommandDefinition(keywordAdd)).toBe(keywordAdd);
    expect(parseCommandDefinition(teachCommand)).toBe(teachCommand);
    expect(parseCommandDefinition(statsCommand)).toBe(statsCommand);
    expect(parseMiddlewareDefinition(keywordMiddleware)).toBe(keywordMiddleware);
    expect(parseMiddlewareDefinition(teachMiddleware)).toBe(teachMiddleware);
    expect(parseMiddlewareDefinition(statsMiddleware)).toBe(statsMiddleware);
    for (const tool of [
      checkinQueryTool,
      checkinRankTool,
      statsQueryTool,
      statsUserTool,
      groupAnnounceTool,
    ]) {
      expect(parseAgentToolDefinition(tool)).toBe(tool);
    }
  });

  it('resolves default config', () => {
    expect(resolveGroupSuiteConfig({}).basePointsMin).toBe(10);
  });

  it('manages keyword store', () => {
    addKeyword('你好', '你好呀', runtime.keywords);
    expect(matchKeyword('说你好', runtime.keywords)).toBe('你好呀');
    expect(listKeywords(runtime.keywords)).toHaveLength(1);
  });

  it('checkin / mypoints work against in-memory store', async () => {
    const result = await checkinCommand.execute({
      ...emptyCtx,
      input: groupInput as never,
    });
    expect(String(result)).toContain('签到成功');
    expect(String(result)).not.toContain('尚未就绪');

    const again = await doCheckin(groupInput, resolveGroupSuiteConfig({}), runtime);
    expect(again).toContain('已经签到');

    const points = await myPoints(groupInput, runtime);
    expect(points).toContain('积分');
    expect(points).toContain('今日已签到');

    const summary = await checkinQueryTool.execute(
      { user_id: 'u1' },
      {
        use: () => runtime,
        origin: { kind: 'im', platform: 'test', endpoint: 'memory', scope: 'group', sceneId: 'g1' },
      } as never,
    );
    expect(String(summary)).toContain('Alice');
  });

  it('并发双签只成功一次（per-user 串行化）', async () => {
    const cfg = resolveGroupSuiteConfig({});
    const results = await Promise.all([
      doCheckin(groupInput, cfg, runtime),
      doCheckin(groupInput, cfg, runtime),
    ]);
    expect(results.filter((r) => r.includes('签到成功'))).toHaveLength(1);
    expect(results.filter((r) => r.includes('已经签到'))).toHaveLength(1);

    const points = await myPoints(groupInput, runtime);
    expect(points).toContain('累计签到: 1 天');
  });

  it('mypoints / rank commands brand and run', async () => {
    await doCheckin(groupInput, resolveGroupSuiteConfig({}), runtime);
    const points = await mypointsCommand.execute({
      ...emptyCtx,
      input: groupInput as never,
    });
    expect(String(points)).toContain('Alice');

    const rank = await rankCommand.execute({
      ...emptyCtx,
      input: groupInput as never,
    });
    expect(String(rank)).toContain('积分排行');
  });

  it('teach add / list / forget / reply work in memory', async () => {
    const taught = await teachCommand.execute({
      ...emptyCtx,
      args: ['你好', '你好呀～'],
      input: groupInput as never,
    });
    expect(String(taught)).toContain('学会了');

    const listed = await teachListCommand.execute({
      ...emptyCtx,
      params: { page: 1 },
      input: groupInput as never,
    });
    expect(String(listed)).toContain('你好');

    const reply = await tryTeachReply(
      { ...groupInput, content: '你好' },
      resolveGroupSuiteConfig({}),
      runtime,
    );
    expect(reply).toContain('你好呀');

    const forgotten = await forgetCommand.execute({
      ...emptyCtx,
      args: ['你好'],
      input: groupInput as never,
    });
    expect(String(forgotten)).toContain('已忘记');
  });

  it('stats count + mystats work in memory', async () => {
    recordMessage(groupInput, runtime);
    recordMessage(groupInput, runtime);
    const stats = await statsCommand.execute({
      ...emptyCtx,
      input: groupInput as never,
    });
    expect(String(stats)).toContain('消息统计');
    expect(String(stats)).toContain('Alice');

    const mine = await mystatsCommand.execute({
      ...emptyCtx,
      input: groupInput as never,
    });
    expect(String(mine)).toContain('今日');
    expect(String(mine)).toMatch(/2 条|2条/);
  });

  it('keyword-add uses params + trailing args', async () => {
    const result = await keywordAdd.execute({
      ...emptyCtx,
      params: { keyword: 'hi' },
      args: ['hello', 'there'],
    });
    expect(String(result)).toContain('已添加');
    expect(matchKeyword('say hi', runtime.keywords)).toBe('hello there');
  });

  it('flushStatsBuffer 只移除写成功的 key，失败行留缓冲不丢计数', async () => {
    const db = createInMemoryGroupSuiteDb();
    const stats = getStatsModel(db)!;
    const runtime = createGroupSuiteRuntime(db);
    const bobInput = { ...groupInput, sender: { id: 'u2', name: 'Bob' }, metadata: { type: 'group', senderName: 'Bob' } };
    recordMessage(groupInput, runtime);
    recordMessage(groupInput, runtime);
    recordMessage(bobInput, runtime);

    // u2 的 insert 持续失败，u1 正常
    const brokenStats = {
      ...stats,
      insert: async (row: Record<string, unknown>) => {
        if (row.user_id === 'u2') throw new Error('db down');
        return stats.insert(row);
      },
    };
    const brokenDb = {
      models: {
        get: (name: string) => (name === 'message_stats' ? brokenStats : db.models.get(name)),
      },
    };
    const brokenRuntime: GroupSuiteRuntime = { ...runtime, db: brokenDb };

    await flushStatsBuffer(brokenRuntime);
    // u1 落库并出缓冲；u2 失败留缓冲
    expect(runtime.statsBuffer.size).toBe(1);
    expect([...runtime.statsBuffer.values()][0]).toMatchObject({ user_id: 'u2', count: 1 });
    let stats1 = await queryStats('g1', '0000-00-00', runtime);
    expect(stats1.get('u1')?.count).toBe(2);
    expect(stats1.get('u2')).toBeUndefined();

    // 恢复后重试，u2 计数不丢
    await flushStatsBuffer(runtime);
    expect(runtime.statsBuffer.size).toBe(0);
    stats1 = await queryStats('g1', '0000-00-00', runtime);
    expect(stats1.get('u1')?.count).toBe(2);
    expect(stats1.get('u2')?.count).toBe(1);
  });
});
