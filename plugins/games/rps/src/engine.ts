export const RPS_PREFIX = 'rps';

export type RpsMove = 'rock' | 'paper' | 'scissors';

export const MOVE_LABELS: Record<RpsMove, string> = {
  rock: '✊ 石头',
  paper: '✋ 布',
  scissors: '✌️ 剪刀',
};

const BEATS: Record<RpsMove, RpsMove> = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
};

export function randomBotMove(): RpsMove {
  const moves: RpsMove[] = ['rock', 'paper', 'scissors'];
  return moves[Math.floor(Math.random() * moves.length)]!;
}

/** 1=玩家胜 2=机器人胜 0=平局 */
export function resolveRound(player: RpsMove, bot: RpsMove): 0 | 1 | 2 {
  if (player === bot) return 0;
  return BEATS[player] === bot ? 1 : 2;
}

export function parseMove(raw: string): RpsMove | null {
  const t = raw.trim().toLowerCase();
  const map: Record<string, RpsMove> = {
    rock: 'rock',
    paper: 'paper',
    scissors: 'scissors',
    石头: 'rock',
    布: 'paper',
    剪刀: 'scissors',
    r: 'rock',
    p: 'paper',
    s: 'scissors',
  };
  return map[t] ?? null;
}

export const WIN_TARGET = 3;
