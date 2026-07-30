import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryGameServices,
  plainTextFromSendContent,
} from '@zhin.js/game-kit';
import middleware from '../middlewares/dungeon-choice.ts';
import {
  createServices,
  type SessionService,
} from '../src/session-service.js';

let service: SessionService;
let nextCalls = 0;
const replies: unknown[] = [];

function makeInput(content: string) {
  return {
    $adapter: 'sandbox',
    $endpoint: 'default',
    $channel: { type: 'group', id: 'room' },
    $sender: { id: 'alice', name: 'Alice' },
    content,
    async $reply(reply: unknown) {
      replies.push(reply);
      return 'message-1';
    },
  };
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
