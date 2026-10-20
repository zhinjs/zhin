import { describe, expect, it } from 'vitest';
import {
  RouletteRuleError,
  createLobby,
  currentPlayer,
  expireLobby,
  expireTurn,
  joinLobby,
  leaveGame,
  pullTrigger,
  startRound,
  survivorsOf,
  type RouletteState,
} from '../src/engine.js';

const rules = { chamberCount: 6, maxPlayers: 3 };
const alice = { id: 'alice', name: 'Alice' };
const bob = { id: 'bob', name: 'Bob' };
const carol = { id: 'carol', name: 'Carol' };
const dave = { id: 'dave', name: 'Dave' };

function threePlayerLobby(): RouletteState {
  const lobby = createLobby(alice, rules);
  const withBob = joinLobby(lobby, bob, rules);
  return joinLobby(withBob, carol, rules);
}

describe('roulette rules', () => {
  it('seats players in join order and refuses duplicates and a full table', () => {
    const lobby = threePlayerLobby();

    expect(lobby.players.map((player) => player.id)).toEqual(['alice', 'bob', 'carol']);
    expect(() => joinLobby(lobby, bob, rules)).toThrow(RouletteRuleError);
    expect(() => joinLobby(lobby, dave, rules)).toThrow('人数已满');
  });

  it('only the host starts, and only with at least two players', () => {
    const alone = createLobby(alice, rules);

    expect(() => startRound(alone, 'alice', 0)).toThrow('至少需要 2 名玩家');
    expect(() => startRound(threePlayerLobby(), 'bob', 0)).toThrow('只有开局的人');
    expect(startRound(threePlayerLobby(), 'alice', 0).phase).toBe('playing');
  });

  it('passes the gun around in join order until the loaded chamber fires', () => {
    let state = startRound(threePlayerLobby(), 'alice', 3);
    const shooters: string[] = [];
    let outcome = 'click';
    while (outcome === 'click') {
      const shooter = currentPlayer(state);
      if (!shooter) throw new Error('no shooter');
      shooters.push(shooter.id);
      const result = pullTrigger(state, shooter.id);
      state = result.state;
      outcome = result.outcome;
    }

    expect(shooters).toEqual(['alice', 'bob', 'carol', 'alice']);
    expect(state.phase).toBe('finished');
    expect(state.endReason).toBe('shot');
    expect(state.loserId).toBe('alice');
    expect(survivorsOf(state).map((player) => player.id)).toEqual(['bob', 'carol']);
  });

  it('ends within one cylinder: the last chamber is always the loaded one', () => {
    let state = startRound(threePlayerLobby(), 'alice', rules.chamberCount - 1);
    let pulls = 0;
    while (state.phase === 'playing') {
      const shooter = currentPlayer(state);
      if (!shooter) throw new Error('no shooter');
      state = pullTrigger(state, shooter.id).state;
      pulls += 1;
    }

    expect(pulls).toBe(rules.chamberCount);
  });

  it('rejects firing out of turn without changing the state', () => {
    const state = startRound(threePlayerLobby(), 'alice', 5);

    expect(() => pullTrigger(state, 'bob')).toThrow('还没轮到你，现在轮到 Alice');
    expect(currentPlayer(state)?.id).toBe('alice');
  });

  it('leaving the lobby hands the table over; leaving a round is a forfeit', () => {
    const lobby = threePlayerLobby();
    const hostLeft = leaveGame(lobby, 'alice');

    expect(hostLeft.hostId).toBe('bob');
    expect(hostLeft.players.map((player) => player.id)).toEqual(['bob', 'carol']);

    const running = startRound(lobby, 'alice', 5);
    const forfeited = leaveGame(running, 'carol');
    expect(forfeited.phase).toBe('finished');
    expect(forfeited.endReason).toBe('forfeit');
    expect(forfeited.loserId).toBe('carol');
  });

  it('the last player leaving dissolves the lobby', () => {
    const lobby = createLobby(alice, rules);

    expect(leaveGame(lobby, 'alice')).toMatchObject({ phase: 'aborted', endReason: 'lobby-empty' });
  });

  it('a turn timeout makes the player on turn lose; a lobby timeout aborts', () => {
    const running = startRound(threePlayerLobby(), 'alice', 5);
    const afterOnePull = pullTrigger(running, 'alice').state;

    expect(expireTurn(afterOnePull)).toMatchObject({
      phase: 'finished',
      endReason: 'turn-timeout',
      loserId: 'bob',
    });
    expect(expireLobby(threePlayerLobby())).toMatchObject({ phase: 'aborted', endReason: 'lobby-expired' });
  });
});
