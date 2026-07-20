import { beforeEach, describe, expect, it } from 'vitest';
import middleware from '../middlewares/rps-choice.ts';
import { mountRpsMemoryServices } from '../src/memory-db.js';
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

describe('rps rps-choice middleware (text fallback)', () => {
  beforeEach(() => {
    replies.length = 0;
    nextCalls = 0;
    services = mountRpsMemoryServices();
  });

  it('数字 1 映射为石头并回复', async () => {
    const input = makeInput('1');
    await services.createSession(input as never);

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
    expect(replies[0]!.length).toBeGreaterThan(0);
  });

  it('数字 3 映射为剪刀并回复', async () => {
    const input = makeInput('3');
    await services.createSession(input as never);

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
  });

  it('无法映射的文本放行给后续中间件', async () => {
    const input = makeInput('出个锤子');
    await services.createSession(input as never);

    await middleware.handle(makeCtx(input), next);

    expect(nextCalls).toBe(1);
    expect(replies.length).toBe(0);
  });
});
