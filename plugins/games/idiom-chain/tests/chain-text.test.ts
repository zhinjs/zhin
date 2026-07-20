import { beforeEach, describe, expect, it } from 'vitest';
import middleware from '../middlewares/chain-text.ts';
import { startGame } from '../src/game-flow.js';
import { mountChainMemoryServices } from '../src/memory-db.js';
import { setGameServices } from '../src/runtime-store.js';
import type { SessionService } from '../src/session-service.js';

const replies: string[] = [];
let nextCalls = 0;

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
    use: () => {
      throw new Error('unused');
    },
  } as never;
}

const next = async () => {
  nextCalls++;
};

describe('idiom-chain chain-text middleware (text fallback)', () => {
  let services: SessionService;

  beforeEach(async () => {
    replies.length = 0;
    nextCalls = 0;
    setGameServices(null);
    services = mountChainMemoryServices();
    await startGame(null, services, makeInput('') as never);
    replies.length = 0;
  });

  it('数字 1 映射为提示并回复', async () => {
    await middleware.handle(makeCtx(makeInput('1')), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
    expect(replies[0]!.length).toBeGreaterThan(0);
  });

  it('中文文本按成语作答处理并回复', async () => {
    await middleware.handle(makeCtx(makeInput('不是成语')), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
    expect(replies[0]).toMatch(/四字成语|词库/);
  });

  it('非中文文本不放行到作答，交给后续中间件', async () => {
    await middleware.handle(makeCtx(makeInput('hello')), next);

    expect(nextCalls).toBe(1);
    expect(replies.length).toBe(0);
  });
});
