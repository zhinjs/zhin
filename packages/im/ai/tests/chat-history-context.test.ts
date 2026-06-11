import { describe, it, expect } from 'vitest';
import { ChatHistoryContext } from '../src/memory/chat-history-context.js';
import type { MessageRecord } from '../src/memory/context-manager.js';

const now = Date.now();

const seed: MessageRecord[] = [
  {
    id: 1,
    platform: 'icqq',
    endpoint_id: 'b1',
    scene_id: 'g1',
    scene_type: 'group',
    scene_name: '',
    sender_id: 'u1',
    sender_name: 'u1',
    sender_role: 'user',
    direction: 'inbound',
    message: 'hello b1',
    time: now - 1000,
  },
  {
    id: 2,
    platform: 'icqq',
    endpoint_id: 'b2',
    scene_id: 'g1',
    scene_type: 'group',
    scene_name: '',
    sender_id: 'u1',
    sender_name: 'u1',
    sender_role: 'user',
    direction: 'inbound',
    message: 'hello b2',
    time: now - 500,
  },
];

function matchWhere(row: MessageRecord, cond: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(cond)) {
    if (k === 'time' && v && typeof v === 'object') {
      const t = row.time;
      const op = v as { $gte?: number; $gt?: number };
      if (op.$gte != null && t < op.$gte) return false;
      if (op.$gt != null && t <= op.$gt) return false;
      continue;
    }
    if ((row as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

function createModels(messages: MessageRecord[]) {
  const messageModel = {
    select: () => ({
      where: (cond: Record<string, unknown>) => Promise.resolve(messages.filter((m) => matchWhere(m, cond))),
    }),
  };
  const summaryModel = {
    select: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  };
  return { messageModel, summaryModel };
}

describe('ChatHistoryContext', () => {
  it('isolates by platform + endpoint_id + scene_id', async () => {
    const { messageModel, summaryModel } = createModels(seed);
    const ctx = new ChatHistoryContext(messageModel, summaryModel, {
      coldStartMaxMessages: 50,
      coldStartMaxAgeMs: 86400000,
    });

    const hist = await ctx.buildHistoryMessages({
      sessionId: 's1',
      platform: 'icqq',
      endpointId: 'b1',
      sceneId: 'g1',
    });

    const userLines = hist.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userLines).toEqual(['hello b1']);
  });

  it('支持 orderBy/limit 链式查询时只取最近 N 条', async () => {
    const many: MessageRecord[] = [];
    for (let i = 0; i < 120; i++) {
      many.push({
        id: i + 1,
        platform: 'icqq',
        endpoint_id: 'b1',
        scene_id: 'g1',
        scene_type: 'group',
        scene_name: '',
        sender_id: 'u1',
        sender_name: 'u1',
        sender_role: 'user',
        direction: 'inbound',
        message: `m${i}`,
        time: now - (120 - i) * 1000,
      });
    }
    const messageModel = {
      select: () => ({
        where: (cond: Record<string, unknown>) => ({
          orderBy: (_f: string, dir: 'ASC' | 'DESC') => ({
            limit: (n: number) => {
              let rows = many.filter((m) => matchWhere(m, cond));
              rows.sort((a, b) => (dir === 'DESC' ? b.time - a.time : a.time - b.time));
              return Promise.resolve(rows.slice(0, n));
            },
          }),
        }),
      }),
    };
    const summaryModel = {
      select: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    };
    const ctx = new ChatHistoryContext(messageModel, summaryModel, {
      coldStartMaxMessages: 10,
      coldStartMaxAgeMs: 86400000,
    });
    const hist = await ctx.buildHistoryMessages({
      sessionId: 's1',
      platform: 'icqq',
      endpointId: 'b1',
      sceneId: 'g1',
    });
    const userLines = hist.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userLines).toHaveLength(10);
    expect(userLines[0]).toBe('m110');
    expect(userLines[9]).toBe('m119');
  });

  it('searchMessages 按关键词从场景消息中筛选', async () => {
    const { messageModel, summaryModel } = createModels(seed);
    const ctx = new ChatHistoryContext(messageModel, summaryModel);
    const result = await ctx.searchMessages(
      { sessionId: 's1', platform: 'icqq', endpointId: 'b1', sceneId: 'g1' },
      'hello',
      10,
    );
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('hello b1');
  });

  it('listRecentMessages 返回最近条数', async () => {
    const { messageModel, summaryModel } = createModels(seed);
    const ctx = new ChatHistoryContext(messageModel, summaryModel);
    const result = await ctx.listRecentMessages(
      { sessionId: 's1', platform: 'icqq', endpointId: 'b2', sceneId: 'g1' },
      5,
    );
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('hello b2');
  });
});
