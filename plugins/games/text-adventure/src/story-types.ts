/** 游戏 payload 前缀 */
export const ADV_PREFIX = 'adv';

export interface SceneChoice {
  id: string;
  label: string;
  style?: 'primary' | 'danger' | 'secondary';
  requires?: (state: GameState) => boolean;
}

export interface Scene {
  id: string;
  text: string | ((state: GameState) => string);
  choices: SceneChoice[];
  terminal?: boolean;
}

export interface GameState {
  sceneId: string;
  hp: number;
  inventory: string[];
  flags: Record<string, boolean>;
  endingId: string;
}

export interface ChoiceResult {
  nextSceneId: string;
  hpDelta?: number;
  addItem?: string;
  removeItem?: string;
  setFlag?: string;
  endingId?: string;
}
