import { beforeEach, describe, expect, it } from 'vitest';
import middleware from '../middlewares/riddle-text.ts';
import { startGame } from '../src/game-flow.js';
import { mountRiddleMemoryServices } from '../src/memory-db.js';
import type { SessionService } from '../src/session-service.js';

const replies: string[] = [];
let nextCalls = 0;
let services: SessionService;

function makeInput(content: string, senderId = 'u1') {
  return {
    $adapter: 'test',
    $endpoint: 'default',
    $channel: { type: 'group', id: 'g1' },
    $sender: { id: senderId, name: senderId },
    content,
    $reply: async (reply: unknown) => {
      replies.push(String(reply));
      return 'mid-1';
    },
  };
}

function makeCtx(input: unknown) {
  return {
    input,
    owner: {},
    generation: 0,
    config: {},
    use: () => services,
  } as never;
}

const next = async () => {
  nextCalls++;
};

describe('word-riddle riddle-text middleware (text fallback)', () => {
  beforeEach(async () => {
    replies.length = 0;
    nextCalls = 0;
    services = mountRiddleMemoryServices();
    await startGame(null, services, makeInput('') as never, 'char');
    replies.length = 0;
  });

  it('数字 1 映射为提示并回复', async () => {
    await middleware.handle(makeCtx(makeInput('1')), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
    expect(replies[0]!.length).toBeGreaterThan(0);
  });

  it('中文谜底文本按作答处理并回复', async () => {
    await middleware.handle(makeCtx(makeInput('莫名其妙')), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
    expect(replies[0]).toMatch(/不对|猜谜/);
  });

  it('非中文文本不放行到作答，交给后续中间件', async () => {
    await middleware.handle(makeCtx(makeInput('hello world')), next);

    expect(nextCalls).toBe(1);
    expect(replies.length).toBe(0);
  });
});
