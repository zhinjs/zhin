const TTT_ACTIONS: Record<string, string> = {
  bot: 'bot',
  join: 'join',
  leave: 'leave',
  quit: 'quit',
  spectate: 'spectate',
  help: 'help',
  人机: 'bot',
  排队: 'join',
  加入: 'join',
  离开: 'leave',
  认输: 'quit',
  退出: 'quit',
  观战: 'spectate',
  帮助: 'help',
};

const ADV_ACTIONS: Record<string, string> = {
  start: 'start',
  continue: 'continue',
  map: 'map',
  achievements: 'achievements',
  achievement: 'achievements',
  quit: 'quit',
  help: 'help',
  开始: 'start',
  继续: 'continue',
  地图: 'map',
  成就: 'achievements',
  放弃: 'quit',
  退出: 'quit',
  帮助: 'help',
  认输: 'quit',
  结束: 'quit',
};

const RPS_ACTIONS: Record<string, string> = {
  start: 'start',
  continue: 'continue',
  quit: 'quit',
  help: 'help',
  开始: 'start',
  继续: 'continue',
  放弃: 'quit',
  帮助: 'help',
  退出: 'quit',
  认输: 'quit',
  结束: 'quit',
};

const GUESS_ACTIONS: Record<string, string> = {
  start: 'start',
  quit: 'quit',
  help: 'help',
  开始: 'start',
  放弃: 'quit',
  帮助: 'help',
  退出: 'quit',
  认输: 'quit',
  结束: 'quit',
};

const DICE_ACTIONS: Record<string, string> = {
  start: 'start',
  continue: 'continue',
  quit: 'quit',
  help: 'help',
  开始: 'start',
  继续: 'continue',
  放弃: 'quit',
  帮助: 'help',
  退出: 'quit',
  认输: 'quit',
  结束: 'quit',
};

const BJ_ACTIONS: Record<string, string> = {
  start: 'start',
  continue: 'continue',
  hit: 'hit',
  stand: 'stand',
  quit: 'quit',
  help: 'help',
  开始: 'start',
  继续: 'continue',
  要牌: 'hit',
  停牌: 'stand',
  放弃: 'quit',
  退出: 'quit',
  帮助: 'help',
};

function lookup(map: Record<string, string>, raw: string): string {
  const t = raw.trim();
  if (!t) return 'help';
  return map[t] ?? map[t.toLowerCase()] ?? t.toLowerCase();
}

export function normalizeTttAction(raw: string): string {
  return lookup(TTT_ACTIONS, raw);
}


export function normalizeAdvAction(raw: string): string {
  return lookup(ADV_ACTIONS, raw);
}

export function normalizeRpsAction(raw: string): string {
  return lookup(RPS_ACTIONS, raw);
}

export function normalizeGuessAction(raw: string): string {
  return lookup(GUESS_ACTIONS, raw);
}

export function normalizeDiceAction(raw: string): string {
  return lookup(DICE_ACTIONS, raw);
}

const CHAIN_ACTIONS: Record<string, string> = {
  start: 'start_pinyin',
  start_pinyin: 'start_pinyin',
  start_char: 'start_char',
  continue: 'continue',
  quit: 'quit',
  help: 'help',
  pinyin: 'start_pinyin',
  char: 'start_char',
  开始: 'start_pinyin',
  同音: 'start_pinyin',
  同字: 'start_char',
  继续: 'continue',
  放弃: 'quit',
  帮助: 'help',
  退出: 'quit',
  认输: 'quit',
  结束: 'quit',
};

const RIDDLE_ACTIONS: Record<string, string> = {
  start: 'start',
  continue: 'continue',
  quit: 'quit',
  help: 'help',
  char: 'char',
  idiom: 'idiom',
  开始: 'start',
  继续: 'continue',
  放弃: 'quit',
  帮助: 'help',
  字谜: 'char',
  成语: 'idiom',
  退出: 'quit',
  认输: 'quit',
  结束: 'quit',
};

export function normalizeChainAction(raw: string): string {
  return lookup(CHAIN_ACTIONS, raw);
}

export function normalizeRiddleAction(raw: string): string {
  return lookup(RIDDLE_ACTIONS, raw);
}

export function normalizeBjAction(raw: string): string {
  return lookup(BJ_ACTIONS, raw);
}

const GAME_ACTIONS = {
  ttt: TTT_ACTIONS,
  adv: ADV_ACTIONS,
  rps: RPS_ACTIONS,
  guess: GUESS_ACTIONS,
  dice: DICE_ACTIONS,
  chain: CHAIN_ACTIONS,
  riddle: RIDDLE_ACTIONS,
  bj: BJ_ACTIONS,
} as const;

/** A game whose action words live in this table. */
export type GameActionTableId = keyof typeof GAME_ACTIONS;

/**
 * Every action word (English and Chinese) the game's table knows — the words a short game entry
 * (`gameCommandMatch`) accepts after its keyword (#1250 第 82 批).
 */
export function gameActionWords(game: GameActionTableId): readonly string[] {
  return Object.freeze(Object.keys(GAME_ACTIONS[game]));
}
