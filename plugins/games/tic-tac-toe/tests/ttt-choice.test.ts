import { beforeEach, describe, expect, it } from 'vitest';
import middleware from '../middlewares/ttt-choice.ts';
import { startBotGame } from '../src/game-flow.js';
import { mountTttMemoryServices } from '../src/memory-db.js';
import { setGameServices } from '../src/runtime-store.js';
import type { SessionServices } from '../src/session-service.js';

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

describe('tic-tac-toe ttt-choice middleware (digit fallback)', () => {
  let services: SessionServices;

  beforeEach(() => {
    replies.length = 0;
    nextCalls = 0;
    setGameServices(null);
    services = mountTttMemoryServices();
  });

  it('裸数字按空格编号映射落子并回复', async () => {
    const input = makeInput('1');
    await startBotGame(null, services, input as never);
    replies.length = 0;

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
    expect(replies[0]!.length).toBeGreaterThan(0);
    const session = await services.session.getActiveForUser(
      'test-default-group:g1',
      'u1',
    );
    // 玩家落子后机器人应手，棋盘上至少已有玩家的 ✕
    expect(session?.move_count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('非法数字（无对应空格）放行给后续中间件', async () => {
    const input = makeInput('42');
    await startBotGame(null, services, input as never);
    replies.length = 0;

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(1);
    expect(replies.length).toBe(0);
  });

  it('非数字文本放行给后续中间件', async () => {
    const input = makeInput('这盘我赢定了');
    await startBotGame(null, services, input as never);
    replies.length = 0;

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(1);
    expect(replies.length).toBe(0);
  });

  it('没有进行中对局时放行', async () => {
    const input = makeInput('1');

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(1);
    expect(replies.length).toBe(0);
  });
});
