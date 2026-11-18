import { beforeEach, describe, expect, it } from 'vitest';
import {
  channelKey,
  createMemoryGameServices,
  plainTextFromSendContent,
} from '@zhin.js/game-kit';
import middleware from '../middlewares/dungeon-choice/index.ts';
import {
  createServices,
  stateFromSession,
  type SessionService,
} from '../src/session-service.js';
import { handleDungeonChoice } from '../src/game-flow.js';
import { buildDungeonView, choicesForState, dungeonSessionToken } from '../src/view.js';

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

  it('maps numeric fallback to the current lobby choice', async () => {
    const input = makeInput('3');
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


describe('shared dungeon cards in a group (#1250 review)', () => {
  beforeEach(() => {
    service = createMemoryGameServices(['dungeon_sessions'], createServices);
    nextCalls = 0;
    replies.length = 0;
  });

  const run = (input: ReturnType<typeof makeInput>) => middleware.handle({
    input, owner: {}, generation: 0, config: {}, use: () => service,
  } as never, async () => { nextCalls += 1; });
  const channel = channelKey(makeInput('') as never);
  const bob = { id: 'bob', name: 'Bob' };
  const press = async (choiceId: string, sender = { id: 'alice', name: 'Alice' }, token?: string) => {
    const session = (await service.getActiveByChannel(channel))!;
    return handleDungeonChoice(service, makeInput('', sender) as never, token ?? dungeonSessionToken(session), choiceId);
  };

  it('the lobby card offers everyone the same 加入 / 准备 / 开始 / 解散 buttons in the same order', async () => {
    const session = await service.createSession(makeInput(''));
    const labels = (content: unknown) => (content as { type: string; data: { rows?: { label: string }[][] } }[])
      .flatMap(item => item.type === 'keyboard' ? item.data.rows!.flat().map(button => button.label) : []);
    const view = buildDungeonView(session, stateFromSession(session), 'group');
    expect(labels(view)).toEqual(['加入队伍', '准备/取消', '开始远征', '解散队伍']);
    expect(choicesForState(stateFromSession(session)).map(choice => choice.id)).toEqual(['join', 'ready', 'start', 'abort']);
    // The number on the card means 加入 for an outsider too.
    await run(makeInput('1', bob));
    expect(nextCalls).toBe(0);
    expect(plainTextFromSendContent(replies[0] as never)).toContain('Bob');
    expect(labels(replies[0])).toEqual(['加入队伍', '准备/取消', '开始远征', '解散队伍']);
  });

  it('refuses 开始 and 解散 from a member who is not the leader', async () => {
    await service.createSession(makeInput(''));
    await press('join', bob);
    expect(String(await press('start', bob))).toContain('队长');
    expect(String(await press('abort', bob))).toBe('只有队长可以结束整支远征。');
    expect((await service.getActiveByChannel(channel))?.status).toBe('active');
  });

  it('确认结束 only ends from the confirmation just requested', async () => {
    await service.createSession(makeInput(''));
    // Without a request, 「确认结束」 is ordinary chat and the confirmation choice is refused.
    await run(makeInput('确认结束'));
    expect(nextCalls).toBe(1);
    expect(String(await press('abort_confirm'))).toContain('已失效');

    // A request, then the party acts: the old confirmation lapses (button and text alike).
    await press('abort');
    const requested = (await service.getActiveByChannel(channel))!;
    const confirmToken = dungeonSessionToken(requested);
    await press('join', bob);
    expect(String(await press('abort_confirm', undefined, confirmToken))).toContain('已失效');
    await run(makeInput('确认结束'));
    expect(nextCalls).toBe(2);
    expect((await service.getActiveByChannel(channel))?.status).toBe('active');

    // 「继续远征」 withdraws a request.
    await press('abort');
    await run(makeInput('继续远征'));
    await run(makeInput('确认结束'));
    expect(nextCalls).toBe(3);
    expect((await service.getActiveByChannel(channel))?.status).toBe('active');

    // A fresh request confirmed right away ends the expedition (by number on its card, too).
    await press('abort');
    replies.length = 0;
    await run(makeInput('1'));
    expect(plainTextFromSendContent(replies[0] as never)).toContain('本次远征由队长结束。');
    expect(await service.getActiveByChannel(channel)).toBeFalsy();
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
