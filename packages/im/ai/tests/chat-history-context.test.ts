import { describe, it, expect } from 'vitest';
import { ChatHistoryContext } from '../src/memory/chat-history-context.js';
import type { MessageRecord } from '../src/memory/context-manager.js';

const now = Date.now();

const seed: MessageRecord[] = [
  {
    id: 1,
    platform: 'icqq',
    bot_id: 'b1',
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
    bot_id: 'b2',
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
  return Object.entries(cond).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
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
  it('isolates by platform + bot_id + scene_id', async () => {
    const { messageModel, summaryModel } = createModels(seed);
    const ctx = new ChatHistoryContext(messageModel, summaryModel, {
      coldStartMaxMessages: 50,
      coldStartMaxAgeMs: 86400000,
    });

    const hist = await ctx.buildHistoryMessages({
      sessionId: 's1',
      platform: 'icqq',
      botId: 'b1',
      sceneId: 'g1',
    });

    const userLines = hist.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userLines).toEqual(['hello b1']);
  });
});
