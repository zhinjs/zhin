import { beforeEach, describe, expect, it } from 'vitest';
import middleware from '../middlewares/chain-text/index.ts';
import { startGame } from '../src/game-flow.js';
import {
  channelKey,
  createMemoryGameServices,
  gamePlayerFromInput,
  plainTextFromSendContent,
  type GameReply,
} from '@zhin.js/game-kit';
import { createServices, type SessionService } from '../src/session-service.js';
import gameCommand from '../commands/chain/[[action]]/index.ts';
import { CHAIN_SHORT_ENTRY } from '../src/command-entry.js';
import { CHAIN_HELP } from '../src/chain-command.js';
import { invokeGameCommand } from '../../../../packages/game-kit/tests/command-operation-fixture.js';

const replies: string[] = [];
let nextCalls = 0;
let services: SessionService;

function makeInput(content: string, senderId = 'u1', commandPrefix?: string) {
  return { ...(commandPrefix !== undefined ? { commandPrefix } : {}), target: { endpoint: { adapter: 'test', id: 'default' }, kind: 'group', id: 'g1' }, conversation: { endpoint: { adapter: 'test', id: 'default' }, kind: 'group', id: 'g1' },
sender: { id: senderId, name: senderId },
content,
$reply: async (reply: unknown) => {
      replies.push(plainTextFromSendContent(reply as GameReply));
      return 'mid-1';
    } };
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

describe('idiom-chain chain-text middleware (text fallback)', () => {
  beforeEach(async () => {
    replies.length = 0;
    nextCalls = 0;
    services = createMemoryGameServices(['idiom_chain_sessions'], createServices);
    await startGame(services, makeInput('') as never);
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

  // #1250 第 82 批: the short entry is the command's own `match` now, and middlewares run before
  // command dispatch. A round in progress must not take the command's text as an idiom.
  describe('the chain command text during a round', () => {
    const current = () => services.getActiveForUser(channelKey(gamePlayerFromInput(makeInput(''))), 'u1');

    it.each(['接龙', '成语接龙', '接龙 帮助', '接龙 继续'])('%s goes on to the command: no idiom, no turn used, no loss', async (text) => {
      const before = await current();
      expect(before?.status).toBe('active');
      await middleware.handle(makeCtx(makeInput(text, 'u1', '')), next);
      expect(nextCalls).toBe(1);
      expect(replies).toEqual([]);
      expect(await current()).toEqual(before);
    });

    it('the bare short word reaches the command, which answers with its help', async () => {
      const result = await invokeGameCommand(gameCommand, {
        owner: {} as never, generation: 0, config: {}, use: () => services, args: [],
        params: { action: '' }, match: CHAIN_SHORT_ENTRY.exec('接龙')!, input: makeInput('接龙') as never,
      });
      expect(String(result)).toBe(CHAIN_HELP);
      expect((await current())?.status).toBe('active');
    });

    it('follows the real prefix: with `/`, `/接龙` is the command and a bare `接龙` is answered', async () => {
      await middleware.handle(makeCtx(makeInput('/接龙', 'u1', '/')), next);
      expect(nextCalls).toBe(1);
      expect(replies).toEqual([]);
      await middleware.handle(makeCtx(makeInput('接龙', 'u1', '/')), next);
      expect(nextCalls).toBe(1);
      expect(replies).toHaveLength(1);
    });
  });
});
