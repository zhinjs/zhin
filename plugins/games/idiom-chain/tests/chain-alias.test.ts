import { beforeEach, describe, expect, it } from 'vitest';
import middleware from '../middlewares/chain-alias.ts';
import { CHAIN_HELP } from '../src/chain-command.js';
import { mountChainMemoryServices } from '../src/memory-db.js';
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

describe('idiom-chain chain-alias middleware', () => {
  beforeEach(() => {
    replies.length = 0;
    nextCalls = 0;
    services = mountChainMemoryServices();
  });

  it('裸命令（无 action）回复帮助', async () => {
    await middleware.handle(makeCtx(makeInput('chain')), next);

    expect(nextCalls).toBe(0);
    expect(replies).toEqual([CHAIN_HELP]);
  });

  it('无法识别的 action 放行给后续中间件（不劫持普通聊天）', async () => {
    await middleware.handle(makeCtx(makeInput('chain 今天天气不错')), next);

    expect(nextCalls).toBe(1);
    expect(replies.length).toBe(0);
  });

  it('可识别的 action 仍被接管', async () => {
    await middleware.handle(makeCtx(makeInput('chain 继续')), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
  });

  it('首词非别名时放行', async () => {
    await middleware.handle(makeCtx(makeInput('hello chain')), next);

    expect(nextCalls).toBe(1);
    expect(replies.length).toBe(0);
  });
});
