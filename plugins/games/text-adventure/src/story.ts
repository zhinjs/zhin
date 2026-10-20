export { ADV_PREFIX } from './story-types.js';
export type { SceneChoice, Scene, GameState, ChoiceResult } from './story-types.js';
export { ITEM_LABELS, ITEM_IDS, itemLabel } from './story-items.js';
export { SCENES, countScenes } from './story-scenes.js';

import type { GameState, ChoiceResult, Scene } from './story-types.js';
import { itemLabel } from './story-items.js';
import { SCENES } from './story-scenes.js';
import { resolveTransition } from './story-transitions.js';

export function parseInventory(value: string | string[] | unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === 'string');
  }
  if (typeof value !== 'string' || !value) return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function parseFlags(value: string | Record<string, boolean> | unknown): Record<string, boolean> {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, boolean>;
  }
  if (typeof value !== 'string' || !value) return {};
  try {
    const v = JSON.parse(value);
    return v != null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}

export function stateFromSession(row: {
  scene_id: string;
  hp: number;
  inventory: string;
  flags: string;
  ending_id: string;
}): GameState {
  return {
    sceneId: row.scene_id,
    hp: row.hp,
    inventory: parseInventory(row.inventory),
    flags: parseFlags(row.flags),
    endingId: row.ending_id,
  };
}

export function formatStatusBar(state: GameState): string {
  const items = state.inventory.length
    ? state.inventory.map(itemLabel).join('、')
    : '无';
  return `❤️ ${Math.max(0, state.hp)}  ·  🎒 ${items}`;
}

export function resolveChoice(state: GameState, choiceId: string): ChoiceResult | null {
  return resolveTransition(state, choiceId);
}

export function getScene(sceneId: string): Scene | undefined {
  return SCENES[sceneId];
}

export function visibleChoices(scene: Scene, state: GameState) {
  return scene.choices.filter((c) => !c.requires || c.requires(state));
}

export function applyChoiceResult(state: GameState, result: ChoiceResult): GameState {
  const inventory = [...state.inventory];
  if (result.addItem && !inventory.includes(result.addItem)) {
    inventory.push(result.addItem);
  }
  if (result.removeItem) {
    const idx = inventory.indexOf(result.removeItem);
    if (idx >= 0) inventory.splice(idx, 1);
  }
  const flags = { ...state.flags };
  if (result.setFlag) flags[result.setFlag] = true;

  const hp = Math.min(100, Math.max(0, state.hp + (result.hpDelta ?? 0)));

  const nextScene = getScene(result.nextSceneId);
  const endingId = result.endingId ?? (nextScene?.terminal ? result.nextSceneId : '');

  return {
    sceneId: result.nextSceneId,
    hp,
    inventory,
    flags,
    endingId,
  };
}

export function sceneNarrative(scene: Scene, state: GameState): string {
  const body = typeof scene.text === 'function' ? scene.text(state) : scene.text;
  if (scene.terminal) return body;
  return `${body}\n\n${formatStatusBar(state)}`;
}
