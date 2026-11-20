import { beforeEach, describe, expect, it } from 'vitest';
import middleware from '../middlewares/riddle-text/index.ts';
import { startGame } from '../src/game-flow.js';
import { channelKey, createMemoryGameServices, gamePlayerFromInput } from '@zhin.js/game-kit';
import { createServices, type SessionService } from '../src/session-service.js';
import gameCommand from '../commands/riddle/[[action]]/index.ts';
import { RIDDLE_SHORT_ENTRY } from '../src/command-entry.js';
import { RIDDLE_HELP } from '../src/riddle-command.js';
import { invokeGameCommand } from '../../../../packages/game-kit/tests/command-operation-fixture.js';

const replies: string[] = [];
const rawReplies: unknown[] = [];
let nextCalls = 0;
let services: SessionService;

function makeInput(content: string, senderId = 'u1', commandPrefix?: string) {
  return { ...(commandPrefix !== undefined ? { commandPrefix } : {}), target: { endpoint: { adapter: 'test', id: 'default' }, kind: 'group', id: 'g1' }, conversation: { endpoint: { adapter: 'test', id: 'default' }, kind: 'group', id: 'g1' },
sender: { id: senderId, name: senderId },
content,
$reply: async (reply: unknown) => {
      replies.push(String(reply));
      rawReplies.push(reply);
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

describe('word-riddle riddle-text middleware (text fallback)', () => {
  beforeEach(async () => {
    replies.length = 0;
    nextCalls = 0;
    services = createMemoryGameServices(['word_riddle_sessions'], createServices);
    await startGame(services, makeInput('') as never, 'char');
    replies.length = 0;
  });

  it('数字 1 映射为提示并回复', async () => {
    await middleware.handle(makeCtx(makeInput('1')), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
    expect(replies[0]!.length).toBeGreaterThan(0);
  });

  it('typing the button label 提示 asks for a hint instead of answering (#1250)', async () => {
    await middleware.handle(makeCtx(makeInput('提示')), next);
    expect(nextCalls).toBe(0);
    expect(JSON.stringify(rawReplies[0])).toMatch(/💡 提示：答案是这几个字之一/);
    expect(JSON.stringify(rawReplies[0])).not.toMatch(/不算失误/);
  });

  it('中文谜底文本按作答处理并回复', async () => {
    await middleware.handle(makeCtx(makeInput('莫名其妙')), next);

    expect(nextCalls).toBe(0);
    expect(replies.length).toBe(1);
    // char 模式答案为单字，多字输入只提示格式、不扣失误
    expect(replies[0]).toMatch(/不对|猜谜|不算失误/);
  });

  it('非中文文本不放行到作答，交给后续中间件', async () => {
    await middleware.handle(makeCtx(makeInput('hello world')), next);

    expect(nextCalls).toBe(1);
    expect(replies.length).toBe(0);
  });

  // #1250 第 82 批: the short entry is the command's own `match` now, and middlewares run before
  // command dispatch. A round in progress must not take the command's text as an answer.
  describe('the riddle command text during a round', () => {
    const current = () => services.getActiveForUser(channelKey(gamePlayerFromInput(makeInput(''))), 'u1');

    it.each(['猜谜', '猜谜语', '猜谜 帮助', '猜谜 继续'])('%s goes on to the command: no answer, no miss, no loss', async (text) => {
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
        params: { action: '' }, match: RIDDLE_SHORT_ENTRY.exec('猜谜')!, input: makeInput('猜谜') as never,
      });
      expect(String(result)).toBe(RIDDLE_HELP);
      expect((await current())?.status).toBe('active');
    });

    it('follows the real prefix: with `/`, `/猜谜` is the command and a bare `猜谜` is an answer', async () => {
      await middleware.handle(makeCtx(makeInput('/猜谜', 'u1', '/')), next);
      expect(nextCalls).toBe(1);
      expect(replies).toEqual([]);
      await middleware.handle(makeCtx(makeInput('猜谜', 'u1', '/')), next);
      expect(nextCalls).toBe(1);
      expect(replies).toHaveLength(1);
    });
  });
});
