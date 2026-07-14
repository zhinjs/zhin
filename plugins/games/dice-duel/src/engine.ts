import { secureRandomIntInclusive } from '@zhin.js/game-shared';

export const DICE_PREFIX = 'dice';
export const WIN_TARGET = 2; // best of 3 -> first to 2

export function rollD6(): number {
  return secureRandomIntInclusive(1, 6);
}

export function diceEmoji(n: number): string {
  const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  return faces[n - 1] ?? String(n);
}

/** 1=玩家胜 2=机器人胜 0=平局 */
export function compareRolls(player: number, bot: number): 0 | 1 | 2 {
  if (player === bot) return 0;
  return player > bot ? 1 : 2;
}
