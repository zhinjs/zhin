/**
 * #1250 game-input-also-reaches-agent: a legal guess during a game is answered by the game only.
 * The digit middleware used to call `next()` after replying, so the same "50" also reached the
 * Agent (two replies). Blackjack's choice middleware was already correct; this pins the same
 * contract here: one reply, no `next()`, outcome `handler_replied` / `game_input`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { channelKey, createMemoryGameServices } from '@zhin.js/game-kit';
import { InboundOutcomeLedger, inboundOutcomeSink } from '@zhin.js/core/runtime';
import digit from '../middlewares/guess-digit/index.ts';
import choice from '../middlewares/guess-choice/index.ts';
import { startGame } from '../src/game-flow.js';
import { createServices, type SessionService } from '../src/session-service.js';

const conversation = { endpoint: { adapter: 'test', id: 'default' }, kind: 'group' as const, id: 'g1' };
const replies: unknown[] = [];
let nextCalls = 0;
let services: SessionService;

function makeInput(content: string, ledger?: InboundOutcomeLedger) {
  return {
    target: conversation, conversation,
    sender: { id: 'u1', name: 'u1' },
    content,
    $reply: async (reply: unknown) => { replies.push(reply); return { status: 'sent' }; },
    ...(ledger ? { [inboundOutcomeSink]: () => ledger } : {}),
  };
}

const makeCtx = (input: unknown) => ({ input, owner: {}, generation: 0, config: {}, use: () => services }) as never;
const next = async () => { nextCalls++; };

describe('guess-number game input ends dispatch (#1250)', () => {
  beforeEach(() => {
    replies.length = 0;
    nextCalls = 0;
    services = createMemoryGameServices(['guess_sessions'], createServices);
  });

  it('answers a legal guess with exactly one reply and never passes it on to the Agent', async () => {
    await startGame(services, makeInput('') as never);
    replies.length = 0;
    const ledger = new InboundOutcomeLedger({ conversation, receivedAt: 1 });

    await digit.handle(makeCtx(makeInput('50', ledger)), next);

    expect(replies).toHaveLength(1);
    expect(nextCalls).toBe(0);
    expect(ledger.settle()).toMatchObject({ outcome: 'handler_replied', reason: 'game_input', stage: 'middleware' });
  });

  it('passes a number on when there is no game in progress', async () => {
    await digit.handle(makeCtx(makeInput('50')), next);
    expect(replies).toHaveLength(0);
    expect(nextCalls).toBe(1);
  });

  it('accepts the button text 「放弃」 and leaves plain chat alone (#1250 game-button-label-text-not-accepted)', async () => {
    await startGame(services, makeInput('') as never);
    replies.length = 0;

    await choice.handle(makeCtx(makeInput('今天天气不错')), next);
    expect(nextCalls).toBe(1);
    expect(replies).toHaveLength(0);

    await choice.handle(makeCtx(makeInput('🏳️ 放弃')), next);
    expect(nextCalls).toBe(1);
    expect(replies).toHaveLength(1);
    const latest = await services.getLatestForUser(channelKey({ target: conversation }), 'u1');
    expect(latest?.status).toBe('aborted');
  });
});
