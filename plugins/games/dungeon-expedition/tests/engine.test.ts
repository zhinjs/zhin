import { describe, expect, it } from 'vitest';
import { DeterministicRandom } from '@zhin.js/game-kit';
import {
  activePlayer,
  applyDungeonAction,
  createDungeonState,
  decodeDungeonState,
  type DungeonAction,
  type DungeonState,
} from '../src/engine.js';

describe('dungeon engine', () => {
  it('runs a multiplayer lobby and enforces turn ownership', () => {
    const random = DeterministicRandom.fromSeed('party');
    let state = createDungeonState('alice', 'Alice');
    state = applyDungeonAction(state, 'bob', { type: 'join', name: 'Bob' }, random);
    state = applyDungeonAction(state, 'bob', { type: 'ready' }, random);
    state = applyDungeonAction(state, 'alice', { type: 'start' }, random);

    expect(state.phase).toBe('exploring');
    expect(state.players).toHaveLength(2);
    expect(() =>
      applyDungeonAction(state, 'bob', { type: 'explore' }, random))
      .toThrow('现在轮到 Alice 行动');
  });

  it('replays a complete campaign from the same seed', () => {
    const first = simulateCampaign('replay-42');
    const second = simulateCampaign('replay-42');

    expect(second).toEqual(first);
    expect(first.state.phase).toBe('completed');
    expect(first.steps).toBeLessThan(500);
  });

  it('survives 1,000 deterministic campaign simulations', () => {
    const outcomes = { victory: 0, defeat: 0, aborted: 0 };
    for (let index = 0; index < 1_000; index += 1) {
      const { state, steps } = simulateCampaign(`soak-${index}`);
      expect(steps).toBeLessThan(500);
      expect(state.phase).toBe('completed');
      expect(state.players.every((player) =>
        player.hp >= 0 && player.hp <= player.maxHp)).toBe(true);
      if (state.result) outcomes[state.result] += 1;
    }
    expect(outcomes.victory + outcomes.defeat).toBe(1_000);
  });

  it('round-trips persisted state without losing schema information', () => {
    const state = createDungeonState('alice', 'Alice');
    expect(decodeDungeonState(JSON.stringify(state))).toEqual(state);
    expect(() => decodeDungeonState('{"schemaVersion":999,"players":[]}'))
      .toThrow('Unsupported dungeon state schema');
  });
});

function simulateCampaign(seed: string): {
  readonly state: DungeonState;
  readonly randomState: number;
  readonly steps: number;
} {
  const random = DeterministicRandom.fromSeed(seed);
  let state = createDungeonState('alice', 'Alice');
  state = applyDungeonAction(state, 'alice', { type: 'start' }, random);
  let steps = 0;
  while (state.phase !== 'completed' && steps < 500) {
    const player = activePlayer(state);
    if (!player) throw new Error('campaign has no active player');
    const action: DungeonAction = player.hp < 45 && player.potions > 0
      ? { type: 'potion' }
      : state.phase === 'combat'
        ? { type: 'attack' }
        : { type: 'explore' };
    state = applyDungeonAction(state, player.id, action, random);
    steps += 1;
  }
  return { state, randomState: random.state, steps };
}
