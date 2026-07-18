import { beforeEach, describe, expect, it } from 'vitest';
import middleware from '../middlewares/bj-choice.ts';
import { mountBjMemoryServices } from '../src/memory-db.js';
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

describe('blackjack bj-choice middleware (text fallback)', () => {
  let services: SessionService;

  beforeEach(() => {
    replies.length = 0;
    nextCalls = 0;
    setGameServices(null);
    services = mountBjMemoryServices();
  });

  it('数字 1 映射为要牌并回复', async () => {
    const input = makeInput('1');
    await services.createSession(input as never);

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
    expect(replies[0]!.length).toBeGreaterThan(0);
  });

  it('数字 2 映射为停牌并结算回复', async () => {
    const input = makeInput('2');
    await services.createSession(input as never);

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
  });

  it('终局后 payload 再来一局可重开', async () => {
    const probe = makeInput('');
    const session = await services.createSession(probe as never);
    await services.updateSession(session.id, { status: 'won' });
    const input = makeInput(`bj:${session.id}:restart`);

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
    // 旧局被废弃
    const old = await services.getById(session.id);
    expect(old?.status).toBe('aborted');
    // 新局若仍在进行，必须是新的一局；若开局即自然 21 会直接结算（此时无 active 局）
    const fresh = await services.getActiveForUser(session.channel_key, 'u1');
    if (fresh) expect(fresh.id).not.toBe(session.id);
  });

  it('直接 payload 文本走 payload 分支', async () => {
    const probe = makeInput('');
    const session = await services.createSession(probe as never);
    const input = makeInput(`bj:${session.id}:stand`);

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
  });

  it('无法映射的文本放行给后续中间件', async () => {
    const input = makeInput('今天天气不错');
    await services.createSession(input as never);

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(1);
    expect(replies.length).toBe(0);
  });
});
