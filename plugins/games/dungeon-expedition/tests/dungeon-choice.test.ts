import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryGameServices,
  plainTextFromSendContent,
} from '@zhin.js/game-kit';
import middleware from '../middlewares/dungeon-choice/index.ts';
import {
  createServices,
  type SessionService,
} from '../src/session-service.js';

let service: SessionService;
let nextCalls = 0;
const replies: unknown[] = [];

function makeInput(content: string, sender = { id: 'alice', name: 'Alice' }) {
  const target = { endpoint: { adapter: 'sandbox', id: 'default' }, kind: 'group' as const, id: 'room' };
  return { target, conversation: target,
sender,
content,
async $reply(reply: unknown) {
      replies.push(reply);
      return 'message-1';
    } };
}

describe('dungeon choice middleware', () => {
  beforeEach(() => {
    service = createMemoryGameServices(
      ['dungeon_sessions'],
      createServices,
    );
    nextCalls = 0;
    replies.length = 0;
  });

  it('maps numeric fallback to the current lobby choice (the leader sees 开始远征 first, #1250)', async () => {
    const input = makeInput('1');
    await service.createSession(input);

    await middleware.handle({
      input,
      owner: {},
      generation: 0,
      config: {},
      use: () => service,
    } as never, async () => {
      nextCalls += 1;
    });

    expect(nextCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(plainTextFromSendContent(replies[0])).toContain('探索中');
  });

  it('passes unrelated chat to the next middleware', async () => {
    const input = makeInput('今天天气怎么样');
    await service.createSession(input);

    await middleware.handle({
      input,
      owner: {},
      generation: 0,
      config: {},
      use: () => service,
    } as never, async () => {
      nextCalls += 1;
    });

    expect(nextCalls).toBe(1);
    expect(replies).toHaveLength(0);
  });
});

describe('dungeon choice middleware in a group (#1250 review)', () => {
  beforeEach(() => {
    service = createMemoryGameServices(['dungeon_sessions'], createServices);
    nextCalls = 0;
    replies.length = 0;
  });

  const run = (input: ReturnType<typeof makeInput>) => middleware.handle({
    input, owner: {}, generation: 0, config: {}, use: () => service,
  } as never, async () => { nextCalls += 1; });

  it.each(['开始远征', '解散队伍', '3', '4'])('a non-member’s 「%s」 is ordinary chat', async (text) => {
    await service.createSession(makeInput(''));
    const bob = { ...makeInput(text), sender: { id: 'bob', name: 'Bob' } };

    await run(bob);

    expect(nextCalls).toBe(1);
    expect(replies).toHaveLength(0);
  });

  it('a non-member can still join by text', async () => {
    await service.createSession(makeInput(''));
    const bob = { ...makeInput('加入队伍'), sender: { id: 'bob', name: 'Bob' } };

    await run(bob);

    expect(nextCalls).toBe(0);
    expect(replies).toHaveLength(1);
  });

  it('ending asks the leader to confirm, then posts a summary (#1250)', async () => {
    await service.createSession(makeInput(''));
    await run(makeInput('解散队伍'));
    const ask = plainTextFromSendContent(replies[0] as never);
    expect(ask).toContain('确定要结束本次远征吗？');
    expect((await service.getActiveByChannel('sandbox:default:group:room'))?.status ?? 'active').toBe('active');
    await run(makeInput('确认结束'));
    const done = plainTextFromSendContent(replies[1] as never);
    expect(done).toContain('本次远征由队长结束。');
    expect(done).toMatch(/本局结算：到达第 1 层 · 清理 0 个房间 · 队伍金币 \d+/);
  });

  it('only offers 加入 to players outside the party', async () => {
    await service.createSession(makeInput(''));
    await run(makeInput('加入队伍'));
    expect(nextCalls).toBe(1);
    await run(makeInput('加入队伍', { id: 'bob', name: 'Bob' }));
    expect(plainTextFromSendContent(replies[0] as never)).toContain('Bob');
  });
});


describe('dungeon command without arguments (#1250 dungeon-entry-unhelpful)', () => {
  it('explains how to start when no party exists', async () => {
    const { runDungeonCommand } = await import('../src/dungeon-command.js');
    service = createMemoryGameServices(['dungeon_sessions'], createServices);
    const player = { ...makeInput(''), locale: 'zh-CN' as const, formatCommand: (path: string) => path };
    const text = String(await runDungeonCommand(service, player as never, ''));
    expect(text).toContain('当前频道没有远征队。');
    expect(text).toContain('dungeon start — 创建远征队');
  });
});
