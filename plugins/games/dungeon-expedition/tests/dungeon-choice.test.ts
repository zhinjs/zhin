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

function makeInput(content: string) {
  const target = { endpoint: { adapter: 'sandbox', id: 'default' }, kind: 'group' as const, id: 'room' };
  return { target, conversation: target,
sender: { id: 'alice', name: 'Alice' },
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
});
