/**
 * 估算最长可玩步数：允许往返同一场景（DFS + 深度上限）
 */
import type { GameState } from './story-types.js';
import { SCENES } from './story-scenes.js';
import { ITEM_IDS } from './story-items.js';
import { resolveTransition } from './story-transitions.js';

const OPTIMISTIC_FLAGS: Record<string, boolean> = {
  spirit_met: true,
  saw_map: true,
  knows_sequence: true,
  whisper_lore: true,
  healed: true,
  rested: true,
  read_archive: true,
  forged_blade: true,
  amulet_upgraded: true,
  moon_blessed: true,
  shadow_banished: true,
};

function optimisticState(sceneId: string): GameState {
  return {
    sceneId,
    hp: 100,
    inventory: [...ITEM_IDS],
    flags: { ...OPTIMISTIC_FLAGS },
    endingId: '',
  };
}

function visibleChoiceIds(state: GameState): string[] {
  const scene = SCENES[state.sceneId];
  if (!scene || scene.terminal) return [];
  return scene.choices
    .filter((c) => !c.requires || c.requires(state))
    .map((c) => c.id);
}

/** 允许回路的最长路径（玩家可多次往返） */
export function estimateLongestPlaythrough(maxDepth = 70): number {
  let best = 0;
  const memo = new Map<string, number>();

  function walk(sceneId: string, depth: number): number {
    if (depth >= maxDepth) return depth;
    const key = `${sceneId}:${depth}`;
    const cached = memo.get(key);
    if (cached != null) return cached;

    const scene = SCENES[sceneId];
    if (scene?.terminal) {
      best = Math.max(best, depth);
      memo.set(key, depth);
      return depth;
    }

    best = Math.max(best, depth);
    let localBest = depth;
    const state = optimisticState(sceneId);

    for (const choiceId of visibleChoiceIds(state)) {
      const result = resolveTransition(state, choiceId);
      if (!result) continue;
      localBest = Math.max(localBest, walk(result.nextSceneId, depth + 1));
    }

    memo.set(key, localBest);
    return localBest;
  }

  walk('start', 0);
  return best;
}
