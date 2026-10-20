import { describe, it, expect } from 'vitest';
import {
  applyChoiceResult,
  getScene,
  resolveChoice,
  visibleChoices,
  type GameState,
} from '../src/story.js';
import { countScenes } from '../src/story-scenes.js';
import { ITEM_IDS } from '../src/story-items.js';
import { estimateLongestPlaythrough } from '../src/story-path.js';

const baseState = (): GameState => ({
  sceneId: 'start',
  hp: 100,
  inventory: [],
  flags: {},
  endingId: '',
});

describe('story scale', () => {
  it('has 20+ playable regions', () => {
    const { playable } = countScenes();
    expect(playable).toBeGreaterThanOrEqual(20);
  });

  it('has 10+ items', () => {
    expect(ITEM_IDS.length).toBeGreaterThanOrEqual(10);
  });

  it('longest playthrough is 50+ steps', () => {
    const steps = estimateLongestPlaythrough();
    expect(steps).toBeGreaterThanOrEqual(50);
  });
});

describe('story', () => {
  it('has start scene with choices', () => {
    const scene = getScene('start');
    expect(scene).toBeDefined();
    expect(visibleChoices(scene!, baseState()).length).toBeGreaterThanOrEqual(3);
  });

  it('resolves treasure ending', () => {
    const state = { ...baseState(), sceneId: 'vault_open' };
    const result = resolveChoice(state, 'take_treasure_now');
    expect(result?.nextSceneId).toBe('treasure');
    const next = applyChoiceResult(state, result!);
    expect(next.endingId).toBe('treasure');
  });

  it('ascension requires whisper lore and upgraded amulet', () => {
    const scene = getScene('throne_room')!;
    const ready = {
      ...baseState(),
      sceneId: 'throne_room',
      inventory: ['scroll', 'amulet'],
      flags: { whisper_lore: true, amulet_upgraded: true, spirit_met: true },
    };
    expect(visibleChoices(scene, ready).some((c) => c.id === 'ascend')).toBe(true);
    const result = resolveChoice(ready, 'ascend');
    expect(result?.endingId).toBe('ascension');
  });

  it('take_torch keeps inventory when returning to start', () => {
    const state = { ...baseState(), sceneId: 'rubble' };
    const next = applyChoiceResult(state, resolveChoice(state, 'take_torch')!);
    expect(next.inventory).toContain('torch');
  });

  it('brew elixir consumes herb', () => {
    const state = { ...baseState(), sceneId: 'greenhouse', inventory: ['herb'] };
    const next = applyChoiceResult(state, resolveChoice(state, 'brew_elixir')!);
    expect(next.inventory).toContain('elixir');
    expect(next.inventory).not.toContain('herb');
  });

  it('star keeper ritual', () => {
    const state = {
      ...baseState(),
      sceneId: 'sunken_shrine',
      inventory: ['moon_shard', 'star_chart'],
      flags: { spirit_met: true },
    };
    const result = resolveChoice(state, 'ritual_star_keeper');
    expect(result?.endingId).toBe('star_keeper');
  });
});
