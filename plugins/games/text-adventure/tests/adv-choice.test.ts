import { beforeEach, describe, expect, it } from 'vitest';
import middleware from '../middlewares/adv-choice.ts';
import { startAdventure } from '../src/game-flow.js';
import { mountAdvMemoryServices } from '../src/memory-db.js';
import { setGameServices } from '../src/runtime-store.js';
import type { GameServices } from '../src/session-service.js';

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

describe('text-adventure adv-choice middleware (text fallback)', () => {
  let services: GameServices;

  beforeEach(() => {
    replies.length = 0;
    nextCalls = 0;
    setGameServices(null);
    services = mountAdvMemoryServices();
  });

  it('数字 1 映射为当前场景第一个选项并回复', async () => {
    const input = makeInput('1');
    await startAdventure(null, services, input as never);
    replies.length = 0;

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
    expect(replies[0]!.length).toBeGreaterThan(0);
  });

  it('超出选项编号的数字放行给后续中间件', async () => {
    const input = makeInput('99');
    await startAdventure(null, services, input as never);
    replies.length = 0;

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(1);
    expect(replies.length).toBe(0);
  });

  it('无法映射的文本放行给后续中间件', async () => {
    const input = makeInput('随便说一句');
    await startAdventure(null, services, input as never);
    replies.length = 0;

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(1);
    expect(replies.length).toBe(0);
  });
});
